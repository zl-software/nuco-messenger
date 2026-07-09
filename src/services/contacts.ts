// Contacts service: adding a contact from a scanned QR card. The card carries the
// identity key AND the signed prekey (since v2), so the scan anchors the peer's key by
// physical presence and establishes the session fully offline; the relay is not involved
// at all. Since card v3 it also names the owner's relay, because handles are namespaced
// per relay: a pair on different relays can never deliver, so the scan warns up front.
// Communication stays locked until mutual verification completes (see verification.ts).

import * as Crypto from 'expo-crypto';

import {
  CONTACT_CARD_VERSION,
  CARD_QR_PREFIX,
  decodeContactCardQr,
  encodeContactCardQr,
  type ContactCard,
} from '@nuco/protocol';
import { isSessionInitiator } from '@/crypto/verification';
import { getSignal, loadAccount, type Account } from './account';
import { reconnectRelay } from './boot';
import { formatFingerprint } from './onboarding';
import { loadPrefs } from './prefs';
import { defaultServerUrl, isSameServer, normalizeServerUrl, resolveServerUrl } from './server';
import { upsertContact, getContactByHandle, deleteContact, type Contact } from '@/db/repos/contacts';
import { ensureConversation } from '@/db/repos/conversations';
import { removeChatLockSecrets } from '@/lock/chat-locks';
import { forgetConfirmState } from './verification';

export type ScanOutcome =
  | { kind: 'added'; contact: Contact; alreadyExisted: boolean }
  | { kind: 'invalid' }
  | { kind: 'notNuco' }
  | { kind: 'incompatibleCard' }
  | { kind: 'self' }
  | { kind: 'wrongServer'; cardServer: string; localServer: string }
  | { kind: 'maybeWrongServer'; localServer: string };

const DEFAULT_RETENTION_SECONDS = 86400;

// The QR payload advertising this device's identity. Public data only, never a private key.
export function buildContactCard(account: Account, serverUrl: string): ContactCard {
  return {
    v: CONTACT_CARD_VERSION,
    handle: account.handle,
    identityKey: account.identityKeyB64,
    registrationId: account.registrationId,
    signedPreKey: account.signedPreKey,
    kyberPreKey: account.kyberPreKey,
    displayName: account.displayName,
    server: serverUrl,
  };
}

// The string rendered into the QR code (card v4: CBOR in base45 with the NC4: prefix).
export function buildContactCardQr(account: Account, serverUrl: string): string {
  return encodeContactCardQr(buildContactCard(account, serverUrl));
}

export function parseScannedCode(data: string): ContactCard | 'invalid' | 'notNuco' | 'incompatibleCard' {
  const trimmed = data.trim();
  if (trimmed.startsWith(CARD_QR_PREFIX)) {
    const card = decodeContactCardQr(trimmed);
    return card ?? 'invalid';
  }
  // A pre 3.0 card was plain JSON: recognizably Nuco, but the peer must update before
  // the pair can scan each other (major 3 is a breaking cut).
  try {
    const parsed = JSON.parse(trimmed) as { v?: unknown; handle?: unknown; identityKey?: unknown };
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.v === 'number' &&
      typeof parsed.handle === 'string' &&
      typeof parsed.identityKey === 'string'
    ) {
      return 'incompatibleCard';
    }
  } catch {
    // fall through
  }
  return 'notNuco';
}

// Add a contact from a scanned card. Fully offline: the card carries everything X3DH
// needs, and physical presence anchors the identity key.
export async function addContactFromCard(
  card: ContactCard,
  opts?: { ignoreServerMismatch?: boolean },
): Promise<ScanOutcome> {
  // Scanning your own code would otherwise create a conversation with yourself.
  const account = await loadAccount();
  if (!account) return { kind: 'invalid' };
  if (card.handle === account.handle) return { kind: 'self' };

  // Handles are namespaced per relay, so a pair on different relays can never message.
  // An explicit mismatch is a hard stop; a legacy card (v1/v2, no server field) is only
  // suspicious when the local user left the default relay, and stays overridable because
  // the peer may well run an old app version on the same custom relay.
  if (!opts?.ignoreServerMismatch) {
    const localServer = resolveServerUrl(await loadPrefs());
    const cardServer = card.server && /^wss?:\/\//i.test(card.server) ? card.server : null;
    if (cardServer && !isSameServer(cardServer, localServer)) {
      return {
        kind: 'wrongServer',
        cardServer: normalizeServerUrl(cardServer),
        localServer: normalizeServerUrl(localServer),
      };
    }
    if (!cardServer && !isSameServer(localServer, defaultServerUrl())) {
      return { kind: 'maybeWrongServer', localServer: normalizeServerUrl(localServer) };
    }
  }

  const existing = await getContactByHandle(card.handle);
  // A re-scan showing a different identity key means the peer re-onboarded (or worse).
  // The old confirms bound the old key, so verification restarts from zero, and the old
  // session plus pinned identity must go FIRST: a stale ratchet under the old key would
  // poison the new pairing, and the decrypt path pins by trust on first use afterward.
  const identityChanged = existing != null && existing.identityPubkey !== card.identityKey;
  const now = Date.now();

  // Deterministic initiator: only the byte smaller identity key runs PQXDH. The other
  // side becomes the responder when the initiator's first sealed (prekey) message
  // arrives, so mutual scanning never creates two racing sessions. processPreKeyBundle
  // also validates the card's prekey signatures against its identity key.
  try {
    if (identityChanged) {
      await getSignal().deleteSession(card.handle);
      forgetConfirmState(card.handle);
    }
    if (isSessionInitiator(account.identityKeyB64, card.identityKey)) {
      if (identityChanged || !(await getSignal().hasSession(card.handle))) {
        await getSignal().startSession(card.handle, {
          identityKey: card.identityKey,
          registrationId: card.registrationId,
          signedPreKey: card.signedPreKey,
          kyberPreKey: card.kyberPreKey,
        });
      }
    }
  } catch {
    return { kind: 'invalid' };
  }

  const contact: Contact = {
    id: existing?.id ?? Crypto.randomUUID(),
    handle: card.handle,
    displayName: card.displayName || card.handle,
    identityPubkey: card.identityKey,
    fingerprint: formatFingerprint(card.identityKey),
    safetyNumber: identityChanged ? null : (existing?.safetyNumber ?? null),
    status: identityChanged ? 'connected' : (existing?.status ?? 'connected'),
    verifiedAt: identityChanged ? null : (existing?.verifiedAt ?? null),
    localConfirmedAt: identityChanged ? null : (existing?.localConfirmedAt ?? null),
    peerConfirmedAt: identityChanged ? null : (existing?.peerConfirmedAt ?? null),
    cardSpkPub: card.signedPreKey.publicKey,
    cardKyberPub: card.kyberPreKey.publicKey,
    blocked: existing?.blocked ?? false,
    muted: existing?.muted ?? false,
    nameSyncPending: existing?.nameSyncPending ?? false,
    createdAt: existing?.createdAt ?? now,
  };
  await upsertContact(contact);
  await ensureConversation(contact.id, contact.id, DEFAULT_RETENTION_SECONDS, now);
  // A confirm sent to us before this contact existed sits unacked at the relay (see the
  // unknown sender rule in messaging). Reconnecting drains the queue and redelivers it
  // now that we can process it.
  void reconnectRelay();
  return { kind: 'added', contact, alreadyExisted: existing !== null };
}

// Remove a contact and every trace tied to it: the chat lock secrets, the db rows
// (conversation and messages cascade from the contact row), the peer's Signal state, and
// the per run confirm bookkeeping. Forgetting the session is load bearing: with it gone,
// a re-add runs the designed first-scan flow (the initiator's confirm is a PREKEY message
// that the relay holds unacked for an unknown receiver, and the responder defers until
// the session exists), instead of racing whisper confirms into the deletion window where
// an unknown-sender whisper is acked and dropped forever.
export async function removeContact(contact: Pick<Contact, 'id' | 'handle'>): Promise<void> {
  await removeChatLockSecrets(contact.id).catch(() => undefined);
  await getSignal().deleteSession(contact.handle);
  forgetConfirmState(contact.handle);
  await deleteContact(contact.id);
}
