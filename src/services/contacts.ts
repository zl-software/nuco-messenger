// Contacts service: adding a contact from a scanned QR card. The card (v2) carries the
// identity key AND the signed prekey, so the scan anchors the peer's key by physical
// presence and establishes the session fully offline; the relay is not involved at all.
// Communication stays locked until mutual verification completes (see verification.ts).

import * as Crypto from 'expo-crypto';

import { CONTACT_CARD_VERSION, isContactCard, type ContactCard } from '@nuco/protocol';
import { isSessionInitiator } from '@/crypto/verification';
import { getSignal, loadAccount, type Account } from './account';
import { reconnectRelay } from './boot';
import { formatFingerprint } from './onboarding';
import { upsertContact, getContactByHandle, type Contact } from '@/db/repos/contacts';
import { ensureConversation } from '@/db/repos/conversations';

export type ScanOutcome =
  | { kind: 'added'; contact: Contact; alreadyExisted: boolean }
  | { kind: 'invalid' }
  | { kind: 'notNuco' }
  | { kind: 'self' };

const DEFAULT_RETENTION_SECONDS = 86400;

// The QR payload advertising this device's identity. Public data only, never a private key.
export function buildContactCard(account: Account): ContactCard {
  return {
    v: CONTACT_CARD_VERSION,
    handle: account.handle,
    identityKey: account.identityKeyB64,
    registrationId: account.registrationId,
    signedPreKey: account.signedPreKey,
    fingerprint: formatFingerprint(account.identityKeyB64),
    displayName: account.displayName,
  };
}

export function parseScannedCode(data: string): ContactCard | 'invalid' | 'notNuco' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return 'notNuco';
  }
  if (!isContactCard(parsed)) return 'notNuco';
  if (!parsed.handle || !parsed.identityKey) return 'invalid';
  return parsed;
}

// Add a contact from a scanned card. Fully offline: the card carries everything X3DH
// needs, and physical presence anchors the identity key.
export async function addContactFromCard(card: ContactCard): Promise<ScanOutcome> {
  // Scanning your own code would otherwise create a conversation with yourself.
  const account = await loadAccount();
  if (!account) return { kind: 'invalid' };
  if (card.handle === account.handle) return { kind: 'self' };

  const existing = await getContactByHandle(card.handle);
  // A re-scan showing a different identity key means the peer re-onboarded (or worse).
  // The old confirms bound the old key, so verification restarts from zero. Proper key
  // change surfacing is deferred to the native libsignal swap.
  const identityChanged = existing != null && existing.identityPubkey !== card.identityKey;
  const now = Date.now();

  // Deterministic initiator: only the byte smaller identity key runs X3DH. The other side
  // becomes the responder when the initiator's first sealed (prekey) message arrives, so
  // mutual scanning never creates two racing sessions. processPreKey also validates the
  // card's signed prekey signature against its identity key.
  try {
    if (isSessionInitiator(account.identityKeyB64, card.identityKey)) {
      if (identityChanged || !(await getSignal().hasSession(card.handle))) {
        await getSignal().startSession(card.handle, {
          identityKey: card.identityKey,
          registrationId: card.registrationId,
          signedPreKey: card.signedPreKey,
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
    fingerprint: card.fingerprint,
    safetyNumber: identityChanged ? null : (existing?.safetyNumber ?? null),
    status: identityChanged ? 'connected' : (existing?.status ?? 'connected'),
    verifiedAt: identityChanged ? null : (existing?.verifiedAt ?? null),
    localConfirmedAt: identityChanged ? null : (existing?.localConfirmedAt ?? null),
    peerConfirmedAt: identityChanged ? null : (existing?.peerConfirmedAt ?? null),
    cardSpkPub: card.signedPreKey.publicKey,
    blocked: existing?.blocked ?? false,
    muted: existing?.muted ?? false,
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
