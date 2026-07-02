// Messaging service: sealing outbound messages and storing inbound ones. Uses the verified
// Signal session (encrypt and decrypt) and the relay transport. The decrypted plaintext is a
// typed content envelope (see @nuco/protocol content), so the same sealed channel carries both
// text and control messages (disappearing message requests).

import * as Crypto from 'expo-crypto';

import { encodeContent, decodeContent, type MessageContent, type MessageEnvelope } from '@nuco/protocol';
import { getContactByHandle } from '@/db/repos/contacts';
import {
  ensureConversation,
  getConversation,
  setRetention,
  setRetentionPending,
  clearRetentionPending,
} from '@/db/repos/conversations';
import { insertMessage, markConversationRead, updateMessageStatus, type MessageKind } from '@/db/repos/messages';
import { getSignal } from './account';
import { emitConversationsChanged } from './data-events';
import { getRelay } from './relay';

function expiryFor(retentionSeconds: number, now: number): number | null {
  return retentionSeconds > 0 ? now + retentionSeconds * 1000 : null;
}

// A retention negotiation event logged in the timeline. The direction carries the actor
// ('out' is the local user, 'in' is the peer); the body carries the requested or applied
// seconds value, localized at render time. Rows expire with the conversation retention
// like any other message.
async function insertSystemMessage(opts: {
  id: string;
  conversationId: string;
  kind: MessageKind;
  direction: 'in' | 'out';
  value: number | null;
  retentionSeconds: number;
  sentAt: number;
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
    expiresAt: expiryFor(opts.retentionSeconds, opts.sentAt),
    read: opts.read,
  });
}

// Seal a typed content envelope toward a contact and hand it to the relay. Returns the
// generated envelope id.
async function sendContent(handle: string, content: MessageContent, id: string): Promise<void> {
  const sealed = await getSignal().encrypt(handle, encodeContent(content));
  const relay = getRelay();
  if (!relay) throw new Error('relay not started');
  await relay.sendEnvelope(handle, { id, ciphertext: sealed.ciphertext, messageType: sealed.messageType, sentAt: Date.now() });
}

// conversation id is the contact id (one to one).
export async function sendText(contact: { id: string; handle: string }, text: string, retentionSeconds: number): Promise<void> {
  const now = Date.now();
  const id = Crypto.randomUUID();
  await ensureConversation(contact.id, contact.id, retentionSeconds, now);
  await insertMessage({
    id,
    conversationId: contact.id,
    direction: 'out',
    kind: 'text',
    body: text,
    status: 'sending',
    sentAt: now,
    expiresAt: expiryFor(retentionSeconds, now),
    read: true,
  });
  emitConversationsChanged(contact.id);
  try {
    await sendContent(contact.handle, { t: 'text', body: text }, id);
    await updateMessageStatus(id, 'sent');
  } catch {
    await updateMessageStatus(id, 'failed');
  }
  emitConversationsChanged(contact.id);
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
  await setRetentionPending(contact.id, value, false);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'retention/request',
    direction: 'out',
    value,
    retentionSeconds: convo.retentionSeconds,
    sentAt: now,
    read: true,
  });
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'retention/request', value });
}

export async function acceptRetention(contact: { id: string; handle: string }, value: number): Promise<void> {
  const now = Date.now();
  await setRetention(contact.id, value);
  await insertSystemMessage({
    id: Crypto.randomUUID(),
    conversationId: contact.id,
    kind: 'retention/changed',
    direction: 'out',
    value,
    retentionSeconds: value,
    sentAt: now,
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
      read: true,
    });
  }
  emitConversationsChanged(contact.id);
  await sendControl(contact.handle, { t: 'retention/cancel' });
}

// Handle an inbound deliver from the relay: decrypt, route by content type, and ack. Returns
// the contact id the message belongs to, or null if the sender is unknown.
export async function receiveEnvelope(from: string, envelope: MessageEnvelope): Promise<string | null> {
  const relay = getRelay();
  try {
    const contact = await getContactByHandle(from);
    if (!contact) {
      // Unknown sender: ack to clear the relay queue but do not store.
      relay?.ack(envelope.id);
      return null;
    }
    const plaintext = await getSignal().decrypt(from, { ciphertext: envelope.ciphertext, messageType: envelope.messageType });
    const content = decodeContent(plaintext);
    const now = Date.now();
    const convo = (await getConversation(contact.id)) ?? (await ensureConversation(contact.id, contact.id, 86400, now));

    switch (content.t) {
      case 'text':
        await insertMessage({
          id: envelope.id,
          conversationId: contact.id,
          direction: 'in',
          kind: 'text',
          body: content.body,
          status: 'delivered',
          sentAt: envelope.sentAt || now,
          expiresAt: expiryFor(convo.retentionSeconds, now),
          read: false,
        });
        break;
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
            read: !declined,
          });
        }
        await clearRetentionPending(contact.id);
        break;
      }
    }

    emitConversationsChanged(contact.id);
    relay?.ack(envelope.id);
    return contact.id;
  } catch {
    // Leave unacked so the relay redelivers; the decryption may succeed after a session repair.
    return null;
  }
}
