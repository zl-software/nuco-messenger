// Messages repository. Bodies are stored decrypted but protected at rest by SQLCipher.

import { getDb } from '../client';

export type MessageDirection = 'in' | 'out';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
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
    body: r.body_encrypted,
    status: r.status as MessageStatus,
    sentAt: r.sent_at,
    expiresAt: r.expires_at,
    read: r.read === 1,
  };
}

export async function insertMessage(m: Message): Promise<void> {
  await getDb().execute(
    `INSERT OR IGNORE INTO messages (id, conversation_id, direction, ciphertext_meta, body_encrypted, status, sent_at, expires_at, read)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [m.id, m.conversationId, m.direction, m.body, m.status, m.sentAt, m.expiresAt, m.read ? 1 : 0],
  );
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const result = await getDb().execute('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at', [conversationId]);
  return (result.rows as unknown as MessageRow[]).map(toMessage);
}

export async function updateMessageStatus(id: string, status: MessageStatus): Promise<void> {
  await getDb().execute('UPDATE messages SET status = ? WHERE id = ?', [status, id]);
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
  unread: number;
}

export async function conversationPreviews(): Promise<ConversationPreview[]> {
  const result = await getDb().execute(
    `SELECT m.conversation_id, m.body_encrypted AS body, m.direction, m.sent_at,
            (SELECT COUNT(*) FROM messages u WHERE u.conversation_id = m.conversation_id AND u.read = 0 AND u.direction = 'in') AS unread
     FROM messages m
     JOIN (SELECT conversation_id, MAX(sent_at) AS mx FROM messages GROUP BY conversation_id) latest
       ON latest.conversation_id = m.conversation_id AND latest.mx = m.sent_at
     ORDER BY m.sent_at DESC`,
  );
  return (result.rows as unknown as Array<{ conversation_id: string; body: string | null; direction: string; sent_at: number; unread: number }>).map(
    (r) => ({ conversationId: r.conversation_id, body: r.body, sentAt: r.sent_at, direction: r.direction as MessageDirection, unread: r.unread }),
  );
}

// Delete messages whose expiry has passed. Returns the number removed.
export async function sweepExpired(now: number): Promise<number> {
  const result = await getDb().execute('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  return result.rowsAffected ?? 0;
}
