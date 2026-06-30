// Conversations repository. One conversation per contact.

import { getDb } from '../client';

export interface Conversation {
  id: string;
  contactId: string;
  retentionSeconds: number;
  retentionPending: boolean;
  retentionPendingValue: number | null;
  retentionPendingIncoming: boolean;
  muted: boolean;
  createdAt: number;
}

interface ConversationRow {
  id: string;
  contact_id: string;
  retention_seconds: number;
  retention_pending: number;
  retention_pending_value: number | null;
  retention_pending_incoming: number;
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
    retentionPendingIncoming: r.retention_pending_incoming === 1,
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
    'INSERT INTO conversations (id, contact_id, retention_seconds, retention_pending, retention_pending_value, retention_pending_incoming, muted, created_at) VALUES (?, ?, ?, 0, NULL, 0, 0, ?)',
    [id, contactId, retentionSeconds, now],
  );
  return {
    id,
    contactId,
    retentionSeconds,
    retentionPending: false,
    retentionPendingValue: null,
    retentionPendingIncoming: false,
    muted: false,
    createdAt: now,
  };
}

export async function setRetention(id: string, seconds: number): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET retention_seconds = ?, retention_pending = 0, retention_pending_value = NULL, retention_pending_incoming = 0 WHERE id = ?',
    [seconds, id],
  );
}

// A pending retention change. `incoming` is true when the peer requested it (we accept or
// decline), false when we requested it (we wait or cancel).
export async function setRetentionPending(id: string, pendingValue: number, incoming: boolean): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET retention_pending = 1, retention_pending_value = ?, retention_pending_incoming = ? WHERE id = ?',
    [pendingValue, incoming ? 1 : 0, id],
  );
}

export async function clearRetentionPending(id: string): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET retention_pending = 0, retention_pending_value = NULL, retention_pending_incoming = 0 WHERE id = ?',
    [id],
  );
}

export async function setConversationMuted(id: string, muted: boolean): Promise<void> {
  await getDb().execute('UPDATE conversations SET muted = ? WHERE id = ?', [muted ? 1 : 0, id]);
}
