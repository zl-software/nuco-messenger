// Messages repository. Bodies are stored decrypted but protected at rest by SQLCipher.

import { getDb } from '../client';

export type MessageDirection = 'in' | 'out';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

// System kinds log the retention negotiation and calls in the timeline. For retention rows
// the direction column carries the actor ('out' means the local user did it, 'in' means the
// peer); for call rows it carries the call direction (who initiated), so a missed incoming
// call counts as unread like any incoming message. Call rows use the callId as the row id,
// making every redelivery or double write an INSERT OR IGNORE no-op; their body holds the
// duration in seconds for completed calls, or a marker ('busy' | 'canceled' | 'error').
export type MessageKind =
  | 'text'
  | 'retention/request'
  | 'retention/changed'
  | 'retention/declined'
  | 'retention/canceled'
  | 'call/outgoing'
  | 'call/incoming'
  | 'call/missed'
  | 'call/declined'
  | 'verified';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  status: MessageStatus;
  sentAt: number;
  expiresAt: number | null;
  read: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  kind: string;
  ciphertext_meta: string | null;
  body_encrypted: string | null;
  status: string;
  sent_at: number;
  expires_at: number | null;
  read: number;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction as MessageDirection,
    kind: r.kind as MessageKind,
    body: r.body_encrypted,
    status: r.status as MessageStatus,
    sentAt: r.sent_at,
    expiresAt: r.expires_at,
    read: r.read === 1,
  };
}

export async function insertMessage(m: Message): Promise<void> {
  await getDb().execute(
    `INSERT OR IGNORE INTO messages (id, conversation_id, direction, kind, ciphertext_meta, body_encrypted, status, sent_at, expires_at, read)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [m.id, m.conversationId, m.direction, m.kind, m.body, m.status, m.sentAt, m.expiresAt, m.read ? 1 : 0],
  );
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const result = await getDb().execute('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at', [conversationId]);
  return (result.rows as unknown as MessageRow[]).map(toMessage);
}

export async function updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
  await getDb().execute('UPDATE messages SET status = ? WHERE id = ?', [status, id]);
}

export interface PendingOutbound {
  id: string;
  conversationId: string;
  body: string;
  handle: string;
}

// Outgoing text still marked 'sending' was interrupted (the in memory relay queue is lost on
// app kill). The conversation id is the contact id, so join to recover the peer handle.
export async function listPendingOutbound(): Promise<PendingOutbound[]> {
  const result = await getDb().execute(
    `SELECT m.id, m.conversation_id AS conversationId, m.body_encrypted AS body, c.handle
     FROM messages m JOIN contacts c ON c.id = m.conversation_id
     WHERE m.direction = 'out' AND m.kind = 'text' AND m.status = 'sending' AND m.body_encrypted IS NOT NULL
     ORDER BY m.sent_at`,
  );
  return result.rows as unknown as PendingOutbound[];
}

// Returns the number of rows actually flipped so callers can emit change events only when
// something changed. The read = 0 predicate is what makes the count 0 on a second call
// (SQLite counts processed rows even when the value is unchanged).
export async function markConversationRead(conversationId: string): Promise<number> {
  const result = await getDb().execute(
    'UPDATE messages SET read = 1 WHERE conversation_id = ? AND direction = ? AND read = 0',
    [conversationId, 'in'],
  );
  return result.rowsAffected ?? 0;
}

export interface ConversationPreview {
  conversationId: string;
  body: string | null;
  sentAt: number;
  direction: MessageDirection;
  kind: MessageKind;
  unread: number;
}

export async function conversationPreviews(): Promise<ConversationPreview[]> {
  // Select exactly one latest row per conversation. Ordering by (sent_at, rowid) breaks ties
  // when two messages share the same millisecond, so a conversation never yields two previews
  // (which would collide on the FlatList key).
  const result = await getDb().execute(
    `SELECT m.conversation_id, m.body_encrypted AS body, m.direction, m.kind, m.sent_at,
            (SELECT COUNT(*) FROM messages u WHERE u.conversation_id = m.conversation_id AND u.read = 0 AND u.direction = 'in') AS unread
     FROM messages m
     WHERE m.rowid = (
       SELECT mm.rowid FROM messages mm
       WHERE mm.conversation_id = m.conversation_id
       ORDER BY mm.sent_at DESC, mm.rowid DESC
       LIMIT 1
     )
     ORDER BY m.sent_at DESC`,
  );
  return (
    result.rows as unknown as Array<{
      conversation_id: string;
      body: string | null;
      direction: string;
      kind: string;
      sent_at: number;
      unread: number;
    }>
  ).map((r) => ({
    conversationId: r.conversation_id,
    body: r.body,
    sentAt: r.sent_at,
    direction: r.direction as MessageDirection,
    kind: r.kind as MessageKind,
    unread: r.unread,
  }));
}

// Delete messages whose expiry has passed. Returns the number removed.
export async function sweepExpired(now: number): Promise<number> {
  const result = await getDb().execute('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  return result.rowsAffected ?? 0;
}
