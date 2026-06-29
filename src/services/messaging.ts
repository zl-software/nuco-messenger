// Messaging service: sealing outbound messages and storing inbound ones. Uses the verified
// Signal session (encrypt and decrypt) and the relay transport.

import * as Crypto from 'expo-crypto';

import { utf8Encode, utf8Decode } from '@/crypto/bytes';
import type { MessageEnvelope } from '@nuco/protocol';
import { getContactByHandle } from '@/db/repos/contacts';
import { ensureConversation, getConversation } from '@/db/repos/conversations';
import { insertMessage, updateMessageStatus } from '@/db/repos/messages';
import { getSignal } from './account';
import { getRelay } from './relay';

function expiryFor(retentionSeconds: number, now: number): number | null {
  return retentionSeconds > 0 ? now + retentionSeconds * 1000 : null;
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
    const sealed = await getSignal().encrypt(contact.handle, utf8Encode(text));
    const envelope: MessageEnvelope = { id, ciphertext: sealed.ciphertext, messageType: sealed.messageType, sentAt: now };
    const relay = getRelay();
    if (!relay) throw new Error('relay not started');
    await relay.sendEnvelope(contact.handle, envelope);
    await updateMessageStatus(id, 'sent');
  } catch {
    await updateMessageStatus(id, 'failed');
  }
}

export async function retrySend(messageId: string, contact: { handle: string }, text: string): Promise<void> {
  await updateMessageStatus(messageId, 'sending');
  try {
    const sealed = await getSignal().encrypt(contact.handle, utf8Encode(text));
    const relay = getRelay();
    if (!relay) throw new Error('relay not started');
    await relay.sendEnvelope(contact.handle, { id: messageId, ciphertext: sealed.ciphertext, messageType: sealed.messageType, sentAt: Date.now() });
    await updateMessageStatus(messageId, 'sent');
  } catch {
    await updateMessageStatus(messageId, 'failed');
  }
}

// Handle an inbound deliver from the relay: decrypt, store, and ack. Returns the contact id
// the message belongs to, or null if the sender is unknown.
export async function receiveEnvelope(from: string, envelope: MessageEnvelope): Promise<string | null> {
  const relay = getRelay();
  try {
    const contact = await getContactByHandle(from);
    if (!contact) {
      // Unknown sender: ack to clear the relay queue but do not store.
      relay?.ack(envelope.id);
      return null;
    }
    const plaintext = utf8Decode(await getSignal().decrypt(from, { ciphertext: envelope.ciphertext, messageType: envelope.messageType }));
    const convo = (await getConversation(contact.id)) ?? (await ensureConversation(contact.id, contact.id, 86400, Date.now()));
    const now = Date.now();
    await insertMessage({
      id: envelope.id,
      conversationId: contact.id,
      direction: 'in',
      body: plaintext,
      status: 'delivered',
      sentAt: envelope.sentAt || now,
      expiresAt: expiryFor(convo.retentionSeconds, now),
      read: false,
    });
    relay?.ack(envelope.id);
    return contact.id;
  } catch {
    // Leave unacked so the relay redelivers; the decryption may succeed after a session repair.
    return null;
  }
}
