// Contacts service: adding a contact from a scanned QR (anchoring their identity key by
// physical presence, fetching their bundle, and establishing a session) and marking a
// contact verified after the in person safety number compare or reciprocal scan.

import * as Crypto from 'expo-crypto';

import { CONTACT_CARD_VERSION, isContactCard, type ContactCard } from '@nuco/protocol';
import { getSignal, loadAccount, type Account } from './account';
import { formatFingerprint } from './onboarding';
import { getRelay } from './relay';
import { upsertContact, getContactByHandle, setVerified, type Contact } from '@/db/repos/contacts';
import { ensureConversation } from '@/db/repos/conversations';

export type ScanOutcome =
  | { kind: 'added'; contact: Contact; alreadyExisted: boolean }
  | { kind: 'invalid' }
  | { kind: 'notNuco' }
  | { kind: 'offline' }
  | { kind: 'mismatch' }
  | { kind: 'self' };

const DEFAULT_RETENTION_SECONDS = 86400;

// The QR payload advertising this device's identity. Public data only, never a private key.
export function buildContactCard(account: Account): ContactCard {
  return {
    v: CONTACT_CARD_VERSION,
    handle: account.handle,
    identityKey: account.identityKeyB64,
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

// Add a contact from a scanned card. Scanning anchors their key by physical presence, so the
// fetched bundle's identity key must match the card. The scanner can then mark verified.
export async function addContactFromCard(card: ContactCard): Promise<ScanOutcome> {
  // Scanning your own code would otherwise create a conversation with yourself.
  const account = await loadAccount();
  if (account && card.handle === account.handle) return { kind: 'self' };

  const relay = getRelay();
  // Fetching the bundle waits on the socket being ready, which never resolves while the relay
  // is unreachable. Give an in progress connect a few seconds, then fail with a clear offline
  // outcome instead of hanging the scan forever.
  if (!relay || !(await relay.waitUntilReady(8000))) return { kind: 'offline' };

  const existing = await getContactByHandle(card.handle);
  const now = Date.now();
  let bundle;
  try {
    bundle = await relay.fetchPreKeyBundle(card.handle);
  } catch {
    return { kind: 'invalid' };
  }
  if (bundle.identityKey !== card.identityKey) return { kind: 'mismatch' };

  try {
    if (!(await getSignal().hasSession(card.handle))) {
      await getSignal().startSession(card.handle, bundle);
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
    safetyNumber: existing?.safetyNumber ?? null,
    status: existing?.status ?? 'connected',
    verifiedAt: existing?.verifiedAt ?? null,
    blocked: existing?.blocked ?? false,
    muted: existing?.muted ?? false,
    createdAt: existing?.createdAt ?? now,
  };
  await upsertContact(contact);
  await ensureConversation(contact.id, contact.id, DEFAULT_RETENTION_SECONDS, now);
  return { kind: 'added', contact, alreadyExisted: existing !== null };
}

export async function markVerified(contactId: string, safetyNumber: string): Promise<void> {
  await setVerified(contactId, safetyNumber, Date.now());
}
