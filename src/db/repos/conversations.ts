// Conversations repository. One conversation per contact.

import { getDb } from '../client';

export interface Conversation {
  id: string;
  contactId: string;
  retentionSeconds: number;
  retentionPending: boolean;
  retentionPendingValue: number | null;
  muted: boolean;
  createdAt: number;
}

interface ConversationRow {
  id: string;
  contact_id: string;
  retention_seconds: number;
  retention_pending: number;
  retention_pending_value: number | null;
  muted: number;
  created_at: number;
}

function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    contactId: r.contact_id,
    retentionSeconds: r.retention_seconds,
    retentionPending: r.retention_pending === 1,
    retentionPendingValue: r.retention_pending_value,
    muted: r.muted === 1,
    createdAt: r.created_at,
  };
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const result = await getDb().execute('SELECT * FROM conversations WHERE id = ?', [id]);
  return result.rows.length ? toConversation(result.rows[0] as unknown as ConversationRow) : null;
}

export async function getConversationByContact(contactId: string): Promise<Conversation | null> {
  const result = await getDb().execute('SELECT * FROM conversations WHERE contact_id = ?', [contactId]);
  return result.rows.length ? toConversation(result.rows[0] as unknown as ConversationRow) : null;
}

export async function ensureConversation(id: string, contactId: string, retentionSeconds: number, now: number): Promise<Conversation> {
  const existing = await getConversationByContact(contactId);
  if (existing) return existing;
  await getDb().execute(
    'INSERT INTO conversations (id, contact_id, retention_seconds, retention_pending, retention_pending_value, muted, created_at) VALUES (?, ?, ?, 0, NULL, 0, ?)',
    [id, contactId, retentionSeconds, now],
  );
  return { id, contactId, retentionSeconds, retentionPending: false, retentionPendingValue: null, muted: false, createdAt: now };
}

export async function setRetention(id: string, seconds: number): Promise<void> {
  await getDb().execute('UPDATE conversations SET retention_seconds = ?, retention_pending = 0, retention_pending_value = NULL WHERE id = ?', [
    seconds,
    id,
  ]);
}

export async function setRetentionPending(id: string, pendingValue: number): Promise<void> {
  await getDb().execute('UPDATE conversations SET retention_pending = 1, retention_pending_value = ? WHERE id = ?', [pendingValue, id]);
}

export async function clearRetentionPending(id: string): Promise<void> {
  await getDb().execute('UPDATE conversations SET retention_pending = 0, retention_pending_value = NULL WHERE id = ?', [id]);
}

export async function setConversationMuted(id: string, muted: boolean): Promise<void> {
  await getDb().execute('UPDATE conversations SET muted = ? WHERE id = ?', [muted ? 1 : 0, id]);
}
