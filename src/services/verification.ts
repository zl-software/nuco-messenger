// The mutual verification state machine. A conversation unlocks only when BOTH people
// scanned each other's QR card and both pressed "the emojis match": local_confirmed_at
// records our press, peer_confirmed_at records the peer's validated verify/confirm. The
// confirm carries a hash of the receiver's card as proof of the scan (only someone who
// held the QR can compute it, see crypto/verification.ts).
//
// Confirm sending is idempotent and fires from three places: the SAS press (deferred for
// a responder without a session yet), the transition when the peer's confirm arrives, and
// the reconnect resend while our confirm is still unanswered. Receivers ignore duplicates,
// and a duplicate incoming confirm triggers one deduped reply (the peer resending means
// our own confirm may not have reached them). verify/confirm is the ONLY content exempt
// from the mutual verification send gate in messaging.

import * as Crypto from 'expo-crypto';

import { computeCardHash } from '@/crypto/verification';
import { getSignal, loadAccount } from './account';
import { emitConversationsChanged } from './data-events';
import {
  sendContent,
  insertVerifiedSystemRow,
  setConfirmHandler,
  setDeferredFlusher,
} from './messaging';
import { isUnlocked } from '@/lock/lock-controller';
import {
  listContacts,
  setLocalConfirmed,
  setPeerConfirmed,
  type Contact,
} from '@/db/repos/contacts';

// Once per app run per handle, so a chatty pending peer cannot make us spam confirms.
// Deleted again when a send fails, so the reconnect resend can retry.
const sentThisRun = new Set<string>();

// The last relay error per handle for a failed confirm send (the wire error code, e.g.
// NO_SUCH_HANDLE when the peer is registered on a different relay). Surfaced by the
// verify screen so the waiting state cannot hang silently forever. In memory only.
const confirmErrors = new Map<string, string>();

export function getConfirmError(handle: string): string | null {
  return confirmErrors.get(handle) ?? null;
}

// Explicit retry from the verify screen after a surfaced failure.
export async function retryConfirm(contact: Contact): Promise<void> {
  sentThisRun.delete(contact.handle);
  confirmErrors.delete(contact.handle);
  emitConversationsChanged(contact.id);
  await sendConfirm(contact);
}

// Wire the inbound handlers into messaging (setter pattern, so messaging never imports
// this module and no import cycle forms). Called from boot before the relay starts.
export function initVerificationService(): void {
  setConfirmHandler(handleInboundConfirm);
  setDeferredFlusher(flushDeferredConfirm);
}

// The SAS press: record our confirmation and send the proof. For a responder without a
// session the send stays deferred; it fires from flushDeferredConfirm after the
// initiator's first message materializes the session.
export async function confirmVerification(contact: Contact): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  const strings = await getSignal().verificationStrings(account.handle, contact.handle, contact.identityPubkey);
  const now = Date.now();
  await setLocalConfirmed(contact.id, strings.safetyNumber, now);
  if (contact.peerConfirmedAt != null) {
    // Our press completes an already peer confirmed pair: log the unlock locally.
    await insertVerifiedSystemRow(contact.id, Crypto.randomUUID(), now, 'out');
  }
  emitConversationsChanged(contact.id);
  if (await getSignal().hasSession(contact.handle)) {
    // Fire and forget: the envelope queues while offline, and the button press must not
    // hang on connectivity.
    void sendConfirm({ ...contact, localConfirmedAt: now });
  }
}

// An incoming verify/confirm, already decrypted by messaging. Validates the proof against
// our OWN card and ignores anything that does not match it.
export async function handleInboundConfirm(
  contact: Contact,
  cardHash: string,
  envelopeId: string,
  sentAt: number,
): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  const ownHash = computeCardHash({
    handle: account.handle,
    identityKey: account.identityKeyB64,
    signedPreKey: { publicKey: account.signedPreKey.publicKey },
  });
  if (cardHash !== ownHash) return;
  if (contact.peerConfirmedAt != null) {
    // Duplicate: the peer resending means our own confirm may not have reached them.
    if (contact.localConfirmedAt != null) void sendConfirm(contact);
    return;
  }
  await setPeerConfirmed(contact.id, Date.now());
  if (contact.localConfirmedAt != null) {
    // The peer's confirm completes the pair: log the unlock (envelope id makes a relay
    // redelivery a no-op) and answer so the peer unlocks too.
    await insertVerifiedSystemRow(contact.id, envelopeId, sentAt, 'in');
    void sendConfirm(contact);
  }
  emitConversationsChanged(contact.id);
}

// On relay connect: re-send the confirm for every contact still waiting on the peer.
// Self heals lost messages and TTL expired queues; duplicates are ignored on receive.
export async function resendPendingConfirms(): Promise<void> {
  if (!isUnlocked()) return;
  let contacts: Contact[];
  try {
    contacts = await listContacts();
  } catch {
    return;
  }
  for (const c of contacts) {
    if (c.blocked || c.localConfirmedAt == null || c.peerConfirmedAt != null) continue;
    // A responder without a session cannot seal anything yet; it stays deferred.
    if (!(await getSignal().hasSession(c.handle))) continue;
    sentThisRun.delete(c.handle);
    await sendConfirm(c);
  }
}

// After a successful decrypt from a still pending contact: the session provably exists
// now, so a confirm deferred at press time (responder role) can finally go out.
export async function flushDeferredConfirm(contact: Contact): Promise<void> {
  if (contact.localConfirmedAt == null || contact.peerConfirmedAt != null) return;
  await sendConfirm(contact);
}

async function sendConfirm(contact: Contact): Promise<void> {
  // cardSpkPub is the peer's signed prekey public key from their scanned card; without it
  // (a pre 2.0 row) no proof can be computed and the pair must re-scan.
  if (sentThisRun.has(contact.handle) || contact.cardSpkPub == null) return;
  sentThisRun.add(contact.handle);
  try {
    await sendContent(
      contact.handle,
      {
        t: 'verify/confirm',
        cardHash: computeCardHash({
          handle: contact.handle,
          identityKey: contact.identityPubkey,
          signedPreKey: { publicKey: contact.cardSpkPub },
        }),
      },
      Crypto.randomUUID(),
    );
    if (confirmErrors.delete(contact.handle)) emitConversationsChanged(contact.id);
  } catch (err) {
    sentThisRun.delete(contact.handle);
    // The relay rejection carries the wire error code as the message (see transport/relay).
    confirmErrors.set(contact.handle, err instanceof Error && err.message ? err.message : 'generic');
    emitConversationsChanged(contact.id);
  }
}
