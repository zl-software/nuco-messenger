// Messaging service: sealing outbound messages and storing inbound ones. Uses the verified
// Signal session (encrypt and decrypt) and the relay transport. The decrypted plaintext is a
// typed content envelope (see @nuco/protocol content), so the same sealed channel carries both
// text and control messages (disappearing message requests).

import * as Crypto from 'expo-crypto';

import { encodeContent, decodeContent, type MessageContent, type MessageEnvelope } from '@nuco/protocol';
import { IdentityChangedError } from '@/crypto';
import {
  getContactByHandle,
  isMutuallyVerified,
  resetVerification,
  setDisplayName as setContactDisplayName,
  type Contact,
} from '@/db/repos/contacts';
import {
  ensureConversation,
  getConversation,
  setRetention,
  setRetentionPending,
  clearRetentionPending,
  setScreenshotProtection,
  setScreenshotPending,
  clearScreenshotPending,
} from '@/db/repos/conversations';
import {
  deleteMessage,
  deletePeerAuthoredMessage,
  getMessage,
  insertMessage,
  listPendingOutbound,
  listPendingOutboundSealed,
  markConversationRead,
  updateMessageStatus,
  type MessageKind,
} from '@/db/repos/messages';
import { getSignal } from './account';
import { emitConversationsChanged } from './data-events';
import { getRelay } from './relay';
import { sealBody } from '@/crypto/chat-lock';
import { isChatUnlocked, openWithReleasedKey } from '@/lock/chat-locks';
import { isUnlocked } from '@/lock/lock-controller';
import type { CallContact, CallSignal } from '@/calls/types';

export function expiryFor(retentionSeconds: number, now: number): number | null {
  return retentionSeconds > 0 ? now + retentionSeconds * 1000 : null;
}

// Call signaling handoff. The call service registers its controller here (the same setter
// pattern services/relay uses for delivery) so messaging never imports the calls service
// and no import cycle forms. The default swallows signals arriving before init, which
// cannot happen in practice: boot wires the call service before the relay starts.
type CallSignalHandler = (from: CallContact, signal: CallSignal, sentAt: number) => Promise<void>;
let callSignalHandler: CallSignalHandler = async () => undefined;
export function setCallSignalHandler(fn: CallSignalHandler): void {
  callSignalHandler = fn;
}

// Verification handoff, same setter pattern: the verification service registers its
// handlers here (via boot) so messaging never imports it and no import cycle forms.
// confirmHandler processes an inbound verify/confirm; deferredFlusher runs after any
// successful decrypt from a still pending contact, because that decrypt proves a session
// exists and a confirm deferred at SAS press time (responder role) can finally go out.
type ConfirmHandler = (contact: Contact, cardHash: string, envelopeId: string, sentAt: number) => Promise<void>;
let confirmHandler: ConfirmHandler = async () => undefined;
export function setConfirmHandler(fn: ConfirmHandler): void {
  confirmHandler = fn;
}
type DeferredFlusher = (contact: Contact) => Promise<void>;
let deferredFlusher: DeferredFlusher = async () => undefined;
export function setDeferredFlusher(fn: DeferredFlusher): void {
  deferredFlusher = fn;
}
// Clears the verification service's per run confirm bookkeeping when a peer's identity
// changes (same setter pattern; the reset itself lives in handleIdentityChange below).
type IdentityResetHandler = (handle: string) => void;
let identityResetHandler: IdentityResetHandler = () => undefined;
export function setIdentityResetHandler(fn: IdentityResetHandler): void {
  identityResetHandler = fn;
}

// A retention negotiation event logged in the timeline. The direction carries the actor
// ('out' is the local user, 'in' is the peer); the body carries the requested or applied
// seconds value, localized at render time. Rows expire with the conversation retention
// like any other message. sentAt orders the timeline (the peer's clock for incoming rows),
// while expiry anchors to expiryFrom, the LOCAL clock, so a delayed delivery or a skewed
// peer clock can neither pre-expire a row nor keep it alive past the retention window.
async function insertSystemMessage(opts: {
  id: string;
  conversationId: string;
  kind: MessageKind;
  direction: 'in' | 'out';
  value: number | string | null;
  retentionSeconds: number;
  sentAt: number;
  expiryFrom: number;
  read: boolean;
}): Promise<void> {
  await insertMessage({
    id: opts.id,
    conversationId: opts.conversationId,
    direction: opts.direction,
    kind: opts.kind,
    body: opts.value != null ? String(opts.value) : null,
    status: opts.direction === 'out' ? 'sent' : 'delivered',
    sentAt: opts.sentAt,
    expiresAt: expiryFor(opts.retentionSeconds, opts.expiryFrom),
    read: opts.read,
  });
}

// The "you verified each other" timeline row, written once when the pair unlocks. Inbound
// completion passes the envelope id (a relay redelivery becomes an INSERT OR IGNORE
// no-op); local completion passes a fresh id.
export async function insertVerifiedSystemRow(
  conversationId: string,
  id: string,
  sentAt: number,
  direction: 'in' | 'out',
): Promise<void> {
  const now = Date.now();
  const convo = (await getConversation(conversationId)) ?? (await ensureConversation(conversationId, conversationId, 86400, now));
  await insertSystemMessage({
    id,
    conversationId,
    kind: 'verified',
    direction,
    value: null,
    retentionSeconds: convo.retentionSeconds,
    sentAt,
    expiryFrom: now,
    read: direction === 'out',
  });
}

// Seal a typed content envelope toward a contact and hand it to the relay. Also used by
// the call service for signaling and the verification service for confirms, so it is
// exported. This is the single send side gate: nothing but verify/confirm may leave for
// a contact who has not completed mutual verification.
export async function sendContent(handle: string, content: MessageContent, id: string): Promise<void> {
  if (content.t !== 'verify/confirm') {
    const contact = await getContactByHandle(handle);
    if (!contact || !isMutuallyVerified(contact)) throw new Error('contact not mutually verified');
  }
  const sealed = await getSignal().encrypt(handle, encodeContent(content));
  const relay = getRelay();
  if (!relay) throw new Error('relay not started');
  await relay.sendEnvelope(handle, { id, ciphertext: sealed.ciphertext, messageType: sealed.messageType, sentAt: Date.now() });
}

// conversation id is the contact id (one to one). replyTo quotes an earlier text by the
// shared message id (see the repo comment); it rides inside the sealed content.
export async function sendText(
  contact: { id: string; handle: string },
  text: string,
  retentionSeconds: number,
  replyTo?: string,
): Promise<void> {
  const now = Date.now();
  const id = Crypto.randomUUID();
  const convo = await ensureConversation(contact.id, contact.id, retentionSeconds, now);
  // In a chat with the per chat lock on, the STORED copy is sealed with the chat pubkey;
  // the wire body below stays plaintext into the Signal channel as always.
  const sealed = convo.lockEnabled && convo.lockPubkey ? sealBody(text, convo.lockPubkey, contact.id, id) : null;
  await insertMessage({
    id,
    conversationId: contact.id,
    direction: 'out',
    kind: 'text',
    body: sealed ? sealed.bodyB64 : text,
    meta: sealed ? sealed.meta : null,
    status: 'sending',
    sentAt: now,
    expiresAt: expiryFor(retentionSeconds, now),
    read: true,
    replyToId: replyTo ?? null,
  });
  emitConversationsChanged(contact.id);
  try {
    await sendContent(contact.handle, textContent(text, replyTo ?? null), id);
    await updateMessageStatus(id, 'sent');
  } catch {
    await updateMessageStatus(id, 'failed');
  }
  emitConversationsChanged(contact.id);
}

function textContent(body: string, replyTo: string | null): MessageContent {
  return replyTo ? { t: 'text', body, replyTo } : { t: 'text', body };
}

// Re-send messages left in 'sending' after an app kill (the relay's outbound queue lives only
// in memory). The relay dedupes by (recipient, id), so a message that did reach the relay is
// not delivered twice. Runs in the background; each send is queued and flushes on connect.
export async function resendPendingOutbound(): Promise<void> {
  if (!isUnlocked()) return;
  let pending;
  try {
    pending = await listPendingOutbound();
  } catch {
    return;
  }
  for (const p of pending) {
    try {
      await sendContent(p.handle, textContent(p.body, p.replyToId), p.id);
      await updateMessageStatus(p.id, 'sent');
    } catch {
      await updateMessageStatus(p.id, 'failed');
    }
    emitConversationsChanged(p.conversationId);
  }
}

// Interrupted outbound in a LOCKED chat: the stored body is sealed, so the resend can only
// happen right after the owner unlocks that chat (the chat screen calls this on unlock).
export async function resendSealedPending(conversationId: string, lockPubkey: string): Promise<void> {
  if (!isUnlocked() || !isChatUnlocked(conversationId)) return;
  let pending;
  try {
    pending = await listPendingOutboundSealed(conversationId);
  } catch {
    return;
  }
  for (const p of pending) {
    try {
      const body = openWithReleasedKey(conversationId, lockPubkey, p.id, p.body, p.meta);
      await sendContent(p.handle, textContent(body, p.replyToId), p.id);
      await updateMessageStatus(p.id, 'sent');
    } catch {
      await updateMessageStatus(p.id, 'failed');
    }
    emitConversationsChanged(p.conversationId);
  }
}

// Delete for me: local only, nothing leaves the device. The emit is here because repos
// never emit.
export async function deleteMessageForMe(conversationId: string, messageId: string): Promise<void> {
  await deleteMessage(messageId);
  emitConversationsChanged(conversationId);
}

// Delete for everyone: remove the local row, then ask the peer to remove theirs (best
// effort, like the retention and screenshot controls; an offline peer gets the queued
// request on reconnect). The guards re-verify what the UI already gated: only own text
// messages in this conversation can be retracted.
export async function deleteMessageForEveryone(contact: { id: string; handle: string }, messageId: string): Promise<void> {
  const m = await getMessage(messageId);
  if (!m || m.conversationId !== contact.id || m.direction !== 'out' || m.kind !== 'text') return;
  await deleteMessage(messageId);
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'message/delete', id: messageId });
}

export async function retrySend(messageId: string, contact: { handle: string }, text: string): Promise<void> {
  await updateMessageStatus(messageId, 'sending');
  emitConversationsChanged();
  try {
    await sendContent(contact.handle, { t: 'text', body: text }, messageId);
    await updateMessageStatus(messageId, 'sent');
  } catch {
    await updateMessageStatus(messageId, 'failed');
  }
  emitConversationsChanged();
}

// Mark all incoming messages in a conversation read and notify listeners only when
// something actually changed. Safe to call redundantly (events, focus, poll) and while
// the db is locked (no-op).
export async function markRead(conversationId: string): Promise<void> {
  try {
    const changed = await markConversationRead(conversationId);
    if (changed > 0) emitConversationsChanged(conversationId);
  } catch {
    // The db can close under the UI (app lock); the next focus re-marks.
  }
}

// ---------------------------------------------------------------------------
// Disappearing message (retention) request and accept flow. A change is a request the other
// side accepts before it applies on either device. State is mirrored locally (so the UI
// reflects it immediately) and signaled to the peer over the sealed channel, best effort.
// ---------------------------------------------------------------------------

async function sendControl(handle: string, content: MessageContent): Promise<void> {
  try {
    await sendContent(handle, content, Crypto.randomUUID());
  } catch {
    // Best effort: the local state already reflects the intent; nothing to roll back.
  }
}

export async function requestRetention(contact: { id: string; handle: string }, value: number): Promise<void> {
  const now = Date.now();
  // Ensure the conversation row exists: setRetentionPending is an UPDATE (a no-op without
  // one) and the system message insert needs the foreign key target.
  const convo = await ensureConversation(contact.id, contact.id, 86400, now);
  // Idempotent, mirroring acceptRetention: a rapid double tap or a stale screen must not log a
  // second request row or resend while our own request is already pending.
  if (convo.retentionPending && !convo.retentionPendingIncoming) return;
  await setRetentionPending(contact.id, value, false);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'retention/request',
    direction: 'out',
    value,
    retentionSeconds: convo.retentionSeconds,
    sentAt: now,
    expiryFrom: now,
    read: true,
  });
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'retention/request', value });
}

export async function acceptRetention(contact: { id: string; handle: string }, value: number): Promise<void> {
  const now = Date.now();
  // Only meaningful while the peer's request is actually pending: a double tap or a stale
  // screen would otherwise double-log the change and send a duplicate accept.
  const convo = await getConversation(contact.id);
  if (!convo?.retentionPending || !convo.retentionPendingIncoming) return;
  await setRetention(contact.id, value);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'retention/changed',
    direction: 'out',
    value,
    retentionSeconds: value,
    sentAt: now,
    expiryFrom: now,
    read: true,
  });
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'retention/accept', value });
}

// Used both when the requester cancels their own pending request and when the recipient
// declines an incoming one: in both cases the peer should drop the pending change.
export async function cancelRetention(contact: { id: string; handle: string }): Promise<void> {
  const now = Date.now();
  const convo = await getConversation(contact.id);
  await clearRetentionPending(contact.id);
  if (convo?.retentionPending) {
    await insertSystemMessage({
      id: Crypto.randomUUID(),
      conversationId: contact.id,
      // Pending from the peer means the local user is declining their request; pending
      // from us means the local user is withdrawing their own.
      kind: convo.retentionPendingIncoming ? 'retention/declined' : 'retention/canceled',
      direction: 'out',
      value: null,
      retentionSeconds: convo.retentionSeconds,
      sentAt: now,
      expiryFrom: now,
      read: true,
    });
  }
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'retention/cancel' });
}

// ---------------------------------------------------------------------------
// Screenshot protection request and accept flow. Same shape as retention: a change is a
// request the other side accepts before it applies on either device. Enforcement itself
// lives in the UI layer (src/ui/use-screenshot-guard.ts); this service only negotiates
// and mirrors the agreed state.
// ---------------------------------------------------------------------------

export async function requestScreenshotProtection(contact: { id: string; handle: string }, on: boolean): Promise<void> {
  const now = Date.now();
  // Ensure the conversation row exists: setScreenshotPending is an UPDATE (a no-op without
  // one) and the system message insert needs the foreign key target.
  const convo = await ensureConversation(contact.id, contact.id, 86400, now);
  // Idempotent, mirroring requestRetention: a rapid double tap or a stale screen must not
  // log a second request row or resend while our own request is already pending.
  if (convo.screenshotPending && !convo.screenshotPendingIncoming) return;
  await setScreenshotPending(contact.id, on, false);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'screenshot/request',
    direction: 'out',
    value: on ? 1 : 0,
    retentionSeconds: convo.retentionSeconds,
    sentAt: now,
    expiryFrom: now,
    read: true,
  });
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'screenshot/request', on });
}

export async function acceptScreenshotProtection(contact: { id: string; handle: string }, on: boolean): Promise<void> {
  const now = Date.now();
  // Only meaningful while the peer's request is actually pending: a double tap or a stale
  // screen would otherwise double-log the change and send a duplicate accept.
  const convo = await getConversation(contact.id);
  if (!convo?.screenshotPending || !convo.screenshotPendingIncoming) return;
  await setScreenshotProtection(contact.id, on);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'screenshot/changed',
    direction: 'out',
    value: on ? 1 : 0,
    retentionSeconds: convo.retentionSeconds,
    sentAt: now,
    expiryFrom: now,
    read: true,
  });
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'screenshot/accept', on });
}

// Used both when the requester cancels their own pending request and when the recipient
// declines an incoming one: in both cases the peer should drop the pending change.
export async function cancelScreenshotProtection(contact: { id: string; handle: string }): Promise<void> {
  const now = Date.now();
  const convo = await getConversation(contact.id);
  await clearScreenshotPending(contact.id);
  if (convo?.screenshotPending) {
    await insertSystemMessage({
      id: Crypto.randomUUID(),
      conversationId: contact.id,
      // Pending from the peer means the local user is declining their request; pending
      // from us means the local user is withdrawing their own.
      kind: convo.screenshotPendingIncoming ? 'screenshot/declined' : 'screenshot/canceled',
      direction: 'out',
      value: null,
      retentionSeconds: convo.retentionSeconds,
      sentAt: now,
      expiryFrom: now,
      read: true,
    });
  }
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'screenshot/cancel' });
}

// Inbound delivery is fire-and-forget from the relay, so two messages can arrive back to back.
// Serialize processing so we never run two decrypts against the same ratchet concurrently,
// which could corrupt session state.
let receiveChain: Promise<unknown> = Promise.resolve();

// Handle an inbound deliver from the relay: decrypt, route by content type, and ack. Returns
// the contact id the message belongs to, or null if the sender is unknown.
export function receiveEnvelope(from: string, envelope: MessageEnvelope): Promise<string | null> {
  const result = receiveChain.then(
    () => doReceiveEnvelope(from, envelope),
    () => doReceiveEnvelope(from, envelope),
  );
  receiveChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function doReceiveEnvelope(from: string, envelope: MessageEnvelope): Promise<string | null> {
  const relay = getRelay();
  // The lock gates decryption: while locked the database is closed and the SQLCipher key is
  // gone. Never decrypt or touch the db here. Leave the message unacked so the relay redelivers
  // it after unlock, when the socket reconnects and drains the queue.
  if (!isUnlocked()) return null;
  try {
    const contact = await getContactByHandle(from);
    if (!contact) {
      // Unknown sender. A prekey envelope can only be the verify/confirm of someone who
      // scanned this device's card before we scanned theirs: leave it UNACKED so it stays
      // queued at the relay (the post scan reconnect redelivers it once the contact
      // exists, or the queue TTL expires it). A whisper envelope from an unknown handle
      // can never become decryptable: ack and drop.
      if (envelope.messageType !== 'prekey') relay?.ack(envelope.id);
      return null;
    }
    if (contact.blocked) {
      // Blocked sender: acknowledge to drain the relay queue, but never decrypt, store, or
      // surface their message.
      relay?.ack(envelope.id);
      return null;
    }
    let plaintext: Uint8Array;
    try {
      plaintext = await getSignal().decrypt(from, { ciphertext: envelope.ciphertext, messageType: envelope.messageType });
    } catch (err) {
      if (err instanceof IdentityChangedError) {
        // The sender's identity key is not the pinned one: the peer re-onboarded (or
        // worse). Nothing was decrypted or persisted. Reset verification exactly like a
        // changed key re-scan does, log the security note, and ACK: the content was
        // produced by an unverified new identity, so even decrypted it would be gated
        // and dropped, and leaving it unacked would redeliver it forever. After the
        // reset the pin is gone, so the peer's NEXT prekey message establishes a fresh
        // session on trust of first use; messaging stays locked until both re-verify.
        await handleIdentityChange(contact, envelope);
        relay?.ack(envelope.id);
        return contact.id;
      }
      throw err;
    }
    const content = decodeContent(plaintext);
    const now = Date.now();

    if (content.t === 'verify/confirm') {
      await confirmHandler(contact, content.cardHash, envelope.id, envelope.sentAt || now);
      relay?.ack(envelope.id);
      return contact.id;
    }
    if (!isMutuallyVerified(contact)) {
      // Strict receive gate: a conforming client never sends anything but verify/confirm
      // before mutual verification, so whatever this is comes from a misbehaving peer.
      // Decrypting above kept the ratchet healthy; ack and drop without storing,
      // displaying, or ringing. The successful decrypt proves a session exists, so a
      // deferred own confirm can go out now.
      await deferredFlusher(contact);
      relay?.ack(envelope.id);
      return contact.id;
    }
    await deferredFlusher(contact);
    const convo = (await getConversation(contact.id)) ?? (await ensureConversation(contact.id, contact.id, 86400, now));

    switch (content.t) {
      case 'text': {
        // A locked chat's bodies are sealed with the chat pubkey before they touch the
        // database; no secret is needed, so this works while the chat is locked.
        const sealed =
          convo.lockEnabled && convo.lockPubkey ? sealBody(content.body, convo.lockPubkey, contact.id, envelope.id) : null;
        await insertMessage({
          id: envelope.id,
          conversationId: contact.id,
          direction: 'in',
          kind: 'text',
          body: sealed ? sealed.bodyB64 : content.body,
          meta: sealed ? sealed.meta : null,
          status: 'delivered',
          sentAt: envelope.sentAt || now,
          expiresAt: expiryFor(convo.retentionSeconds, now),
          read: false,
          replyToId: content.replyTo ?? null,
        });
        break;
      }
      // System rows reuse the envelope id, so insertMessage's INSERT OR IGNORE makes a
      // relay redelivery a no-op. Incoming request, changed, and declined rows arrive
      // unread on purpose: they surface as the unread badge on the chats list.
      case 'retention/request':
        await setRetentionPending(contact.id, content.value, true);
        await insertSystemMessage({
          id: envelope.id,
          conversationId: contact.id,
          kind: 'retention/request',
          direction: 'in',
          value: content.value,
          retentionSeconds: convo.retentionSeconds,
          sentAt: envelope.sentAt || now,
          expiryFrom: now,
          read: false,
        });
        break;
      case 'retention/accept':
        await setRetention(contact.id, content.value);
        await insertSystemMessage({
          id: envelope.id,
          conversationId: contact.id,
          kind: 'retention/changed',
          direction: 'in',
          value: content.value,
          retentionSeconds: content.value,
          sentAt: envelope.sentAt || now,
          expiryFrom: now,
          read: false,
        });
        break;
      case 'retention/cancel': {
        // The wire message carries no reason. Local pending state disambiguates: our
        // request pending means the peer declined it; their own pending means they
        // withdrew it. Nothing pending means a stale duplicate, log nothing.
        if (convo.retentionPending) {
          const declined = !convo.retentionPendingIncoming;
          await insertSystemMessage({
            id: envelope.id,
            conversationId: contact.id,
            kind: declined ? 'retention/declined' : 'retention/canceled',
            direction: 'in',
            value: null,
            retentionSeconds: convo.retentionSeconds,
            sentAt: envelope.sentAt || now,
            expiryFrom: now,
            read: !declined,
          });
        }
        await clearRetentionPending(contact.id);
        break;
      }
      case 'screenshot/request':
        await setScreenshotPending(contact.id, content.on, true);
        await insertSystemMessage({
          id: envelope.id,
          conversationId: contact.id,
          kind: 'screenshot/request',
          direction: 'in',
          value: content.on ? 1 : 0,
          retentionSeconds: convo.retentionSeconds,
          sentAt: envelope.sentAt || now,
          expiryFrom: now,
          read: false,
        });
        break;
      case 'screenshot/accept':
        await setScreenshotProtection(contact.id, content.on);
        await insertSystemMessage({
          id: envelope.id,
          conversationId: contact.id,
          kind: 'screenshot/changed',
          direction: 'in',
          value: content.on ? 1 : 0,
          retentionSeconds: convo.retentionSeconds,
          sentAt: envelope.sentAt || now,
          expiryFrom: now,
          read: false,
        });
        break;
      case 'screenshot/cancel': {
        // Same disambiguation as retention/cancel: our request pending means the peer
        // declined it; their own pending means they withdrew it; nothing pending means a
        // stale duplicate, log nothing.
        if (convo.screenshotPending) {
          const declined = !convo.screenshotPendingIncoming;
          await insertSystemMessage({
            id: envelope.id,
            conversationId: contact.id,
            kind: declined ? 'screenshot/declined' : 'screenshot/canceled',
            direction: 'in',
            value: null,
            retentionSeconds: convo.retentionSeconds,
            sentAt: envelope.sentAt || now,
            expiryFrom: now,
            read: !declined,
          });
        }
        await clearScreenshotPending(contact.id);
        break;
      }
      case 'call/offer':
      case 'call/accept':
      case 'call/answer':
      case 'call/end':
        // Signaling is plumbing: no timeline row here. The call controller writes summary
        // rows at terminal transitions, dedupes by callId, and never throws (a throw here
        // would leave the envelope unacked and redelivered forever).
        await callSignalHandler(
          { id: contact.id, handle: contact.handle, displayName: contact.displayName },
          content,
          envelope.sentAt || now,
        );
        break;
      case 'message/delete':
        // The peer retracts a text they authored. The repo predicate enforces authorship
        // (direction 'in'), conversation scope, and kind 'text'; a miss (already expired,
        // cleared, or never stored) is a silent no-op. No tombstone row, consistent with
        // the disappearing message model. Resurrection by redelivery is a non issue: the
        // original text was acked in the same tick it was stored, so by the time anyone
        // can delete it the relay queue no longer holds it (only an ack lost with a dying
        // socket in that ms scale window could bring it back, and then it is simply
        // deleted again).
        await deletePeerAuthoredMessage(content.id, contact.id);
        break;
      case 'profile/name': {
        // The peer renamed themselves. Applying it is cooperative client behavior; the
        // display name never participates in verification (it is not part of the
        // cardHash). An unchanged name breaks straight to the shared ack, which makes
        // reconnect resends and relay redeliveries harmless. The note body carries both
        // names as JSON so the row still reads correctly after later renames.
        const newName = content.name.trim();
        if (!newName || newName === contact.displayName) break;
        await setContactDisplayName(contact.id, newName);
        await insertSystemMessage({
          id: envelope.id,
          conversationId: contact.id,
          kind: 'name/changed',
          direction: 'in',
          value: JSON.stringify({ old: contact.displayName, new: newName }),
          retentionSeconds: convo.retentionSeconds,
          sentAt: envelope.sentAt || now,
          expiryFrom: now,
          read: false,
        });
        break;
      }
      case 'unknown':
        // Structured content from a newer peer: ack and drop, never render as text.
        break;
    }

    emitConversationsChanged(contact.id);
    relay?.ack(envelope.id);
    return contact.id;
  } catch {
    // Leave unacked so the relay redelivers; the decryption may succeed after a session repair.
    return null;
  }
}

// A peer's identity key changed. Mirrors the scan time reset in contacts.ts: both
// confirms and the stored card prekeys are cleared (they bound the old identity), the
// per run confirm state is forgotten, and the stale ratchet plus the old pin are
// dropped. The system note uses the envelope id, so a redelivery racing the ack is an
// INSERT OR IGNORE no-op; envelopes decrypted after the reset flow through the normal
// path and are silently gated (the pair is unverified now), so the note appears once.
async function handleIdentityChange(contact: Contact, envelope: MessageEnvelope): Promise<void> {
  await resetVerification(contact.id);
  identityResetHandler(contact.handle);
  await getSignal().deleteSession(contact.handle);
  const now = Date.now();
  const convo = (await getConversation(contact.id)) ?? (await ensureConversation(contact.id, contact.id, 86400, now));
  await insertSystemMessage({
    id: envelope.id,
    conversationId: contact.id,
    kind: 'identity/changed',
    direction: 'in',
    value: null,
    retentionSeconds: convo.retentionSeconds,
    sentAt: envelope.sentAt || now,
    expiryFrom: now,
    read: false,
  });
  emitConversationsChanged(contact.id);
}
