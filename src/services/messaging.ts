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
import { insertMessage, updateMessageStatus } from '@/db/repos/messages';
import { getSignal } from './account';
import { getRelay } from './relay';

function expiryFor(retentionSeconds: number, now: number): number | null {
  return retentionSeconds > 0 ? now + retentionSeconds * 1000 : null;
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
    body: text,
    status: 'sending',
    sentAt: now,
    expiresAt: expiryFor(retentionSeconds, now),
    read: true,
  });
  try {
    await sendContent(contact.handle, { t: 'text', body: text }, id);
    await updateMessageStatus(id, 'sent');
  } catch {
    await updateMessageStatus(id, 'failed');
  }
}

export async function retrySend(messageId: string, contact: { handle: string }, text: string): Promise<void> {
  await updateMessageStatus(messageId, 'sending');
  try {
    await sendContent(contact.handle, { t: 'text', body: text }, messageId);
    await updateMessageStatus(messageId, 'sent');
  } catch {
    await updateMessageStatus(messageId, 'failed');
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
  await setRetentionPending(contact.id, value, false);
  await sendControl(contact.handle, { t: 'retention/request', value });
}

export async function acceptRetention(contact: { id: string; handle: string }, value: number): Promise<void> {
  await setRetention(contact.id, value);
  await sendControl(contact.handle, { t: 'retention/accept', value });
}

// Used both when the requester cancels their own pending request and when the recipient
// declines an incoming one: in both cases the peer should drop the pending change.
export async function cancelRetention(contact: { id: string; handle: string }): Promise<void> {
  await clearRetentionPending(contact.id);
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
          body: content.body,
          status: 'delivered',
          sentAt: envelope.sentAt || now,
          expiresAt: expiryFor(convo.retentionSeconds, now),
          read: false,
        });
        break;
      case 'retention/request':
        await setRetentionPending(contact.id, content.value, true);
        break;
      case 'retention/accept':
        await setRetention(contact.id, content.value);
        break;
      case 'retention/cancel':
        await clearRetentionPending(contact.id);
        break;
    }

    relay?.ack(envelope.id);
    return contact.id;
  } catch {
    // Leave unacked so the relay redelivers; the decryption may succeed after a session repair.
    return null;
  }
}
