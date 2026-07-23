// Messages repository. Bodies are stored decrypted and protected at rest by SQLCipher,
// EXCEPT in chats with the per chat lock on: their text bodies are additionally sealed
// with the chat's pubkey (crypto/chat-lock.ts) and carry the sealing parameters in
// ciphertext_meta. A non NULL ciphertext_meta is the single "this row is sealed"
// discriminator; NULL meta rows are plaintext and render as-is.

import { getDb } from '../client';

export type MessageDirection = 'in' | 'out';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';

// System kinds log the retention and screenshot protection negotiations and calls in the
// timeline. For retention and screenshot rows the direction column carries the actor ('out'
// means the local user did it, 'in' means the peer); screenshot rows carry '1' or '0' in the
// body (the requested or applied on/off state). For call rows the direction carries the call
// direction (who initiated), so a missed incoming call counts as unread like any incoming
// message. Call rows use the callId as the row id, making every redelivery or double write
// an INSERT OR IGNORE no-op; their body holds the duration in seconds for completed calls,
// or a marker ('busy' | 'canceled' | 'error').
export type MessageKind =
  | 'text'
  // An image bubble. The body is the base64 of the encoded (metadata stripped) jpeg,
  // sealed like a text body in chat locked conversations; media_meta carries the unsealed
  // layout JSON {mime, width, height, bytes}. The row id is the announcement envelope id.
  | 'image'
  | 'retention/request'
  | 'retention/changed'
  | 'retention/declined'
  | 'retention/canceled'
  | 'screenshot/request'
  | 'screenshot/changed'
  | 'screenshot/declined'
  | 'screenshot/canceled'
  | 'call/outgoing'
  | 'call/incoming'
  | 'call/missed'
  | 'call/declined'
  | 'verified'
  // The peer renamed themselves (receiver side only). The body is a JSON string
  // {"old":..,"new":..} carrying both names, so the note still reads correctly after
  // later renames; the row id is the envelope id (redelivery is an INSERT OR IGNORE no-op).
  | 'name/changed'
  // The peer's identity key changed (receiver side only): a prekey message arrived under
  // a different identity than the pinned one, verification was reset, and messaging stays
  // locked until both people re-scan. The row id is the triggering envelope id.
  | 'identity/changed'
  // Written once per conversation by the break clean migration to native libsignal
  // (PQXDH): the local identity was regenerated, every pair must re-scan and re-verify.
  | 'security/upgrade';

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  // Sealing parameters JSON when the body is chat lock sealed; null/absent = plaintext.
  meta?: string | null;
  status: MessageStatus;
  sentAt: number;
  expiresAt: number | null;
  read: boolean;
  // Shared id of the quoted text when this row is a reply (both peers key a text by the
  // same envelope id). Resolved best effort at render; the referenced row may be gone.
  replyToId?: string | null;
  // Unsealed layout JSON for image rows: {mime, width, height, bytes}. Never contains
  // image content and never participates in chat lock sealing.
  mediaMeta?: string | null;
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
  reply_to_id: string | null;
  media_meta: string | null;
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction as MessageDirection,
    kind: r.kind as MessageKind,
    body: r.body_encrypted,
    meta: r.ciphertext_meta,
    status: r.status as MessageStatus,
    sentAt: r.sent_at,
    expiresAt: r.expires_at,
    read: r.read === 1,
    replyToId: r.reply_to_id,
    mediaMeta: r.media_meta,
  };
}

export async function insertMessage(m: Message): Promise<void> {
  await getDb().execute(
    `INSERT OR IGNORE INTO messages (id, conversation_id, direction, kind, ciphertext_meta, body_encrypted, status, sent_at, expires_at, read, reply_to_id, media_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.conversationId, m.direction, m.kind, m.meta ?? null, m.body, m.status, m.sentAt, m.expiresAt, m.read ? 1 : 0, m.replyToId ?? null, m.mediaMeta ?? null],
  );
}

export async function getMessage(id: string): Promise<Message | null> {
  const result = await getDb().execute('SELECT * FROM messages WHERE id = ?', [id]);
  const row = result.rows[0] as unknown as MessageRow | undefined;
  return row ? toMessage(row) : null;
}

// Delete for me: local only. Also cancels an interrupted resend of the row, since the
// boot time resend derives from rows still marked 'sending'.
export async function deleteMessage(id: string): Promise<void> {
  await getDb().execute('DELETE FROM messages WHERE id = ?', [id]);
}

// The receive side of message/delete. The direction predicate is the authorization check
// (a peer may only retract what they authored), the conversation scope stops ids replayed
// across chats, and the kind keeps system rows out of reach. A miss (already expired,
// cleared, or never stored) deletes nothing, which is the correct silent no-op.
export async function deletePeerAuthoredMessage(id: string, conversationId: string): Promise<number> {
  const result = await getDb().execute(
    "DELETE FROM messages WHERE id = ? AND conversation_id = ? AND direction = 'in' AND kind IN ('text', 'image')",
    [id, conversationId],
  );
  return result.rowsAffected ?? 0;
}

// Used by the enable (seal) and disable (unseal) history passes.
export async function updateMessageBody(id: string, body: string, meta: string | null): Promise<void> {
  await getDb().execute('UPDATE messages SET body_encrypted = ?, ciphertext_meta = ? WHERE id = ?', [body, meta, id]);
}

// Plaintext text and image rows of one conversation, oldest first, for the batched seal
// pass. The meta IS NULL predicate makes the pass idempotent and resumable after a crash.
export async function listSealablePlaintext(conversationId: string, limit: number): Promise<Message[]> {
  const result = await getDb().execute(
    `SELECT * FROM messages WHERE conversation_id = ? AND kind IN ('text', 'image') AND ciphertext_meta IS NULL AND body_encrypted IS NOT NULL
     ORDER BY sent_at LIMIT ?`,
    [conversationId, limit],
  );
  return (result.rows as unknown as MessageRow[]).map(toMessage);
}

// Sealed rows of one conversation for the batched disable (decrypt back) pass.
export async function listSealedRows(conversationId: string, limit: number): Promise<Message[]> {
  const result = await getDb().execute(
    `SELECT * FROM messages WHERE conversation_id = ? AND ciphertext_meta IS NOT NULL
     ORDER BY sent_at LIMIT ?`,
    [conversationId, limit],
  );
  return (result.rows as unknown as MessageRow[]).map(toMessage);
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
  kind: MessageKind;
  body: string;
  handle: string;
  replyToId: string | null;
  mediaMeta: string | null;
}

// Outgoing text or images still marked 'sending' were interrupted (the in memory relay
// queue is lost on app kill). The conversation id is the contact id, so join to recover
// the peer handle. Sealed rows are excluded: their stored body is ciphertext, and only the
// chat's released private key can recover the plaintext (see listPendingOutboundSealed).
export async function listPendingOutbound(): Promise<PendingOutbound[]> {
  const result = await getDb().execute(
    `SELECT m.id, m.conversation_id AS conversationId, m.kind, m.body_encrypted AS body, m.reply_to_id AS replyToId, m.media_meta AS mediaMeta, c.handle
     FROM messages m JOIN contacts c ON c.id = m.conversation_id
     WHERE m.direction = 'out' AND m.kind IN ('text', 'image') AND m.status = 'sending' AND m.body_encrypted IS NOT NULL
       AND m.ciphertext_meta IS NULL
     ORDER BY m.sent_at`,
  );
  return result.rows as unknown as PendingOutbound[];
}

export interface PendingOutboundSealed extends PendingOutbound {
  meta: string;
}

// Interrupted outbound whose stored body is sealed. Resent right after the owner unlocks
// that chat, the only moment the plaintext can be recovered.
export async function listPendingOutboundSealed(conversationId: string): Promise<PendingOutboundSealed[]> {
  const result = await getDb().execute(
    `SELECT m.id, m.conversation_id AS conversationId, m.kind, m.body_encrypted AS body, m.ciphertext_meta AS meta, m.reply_to_id AS replyToId, m.media_meta AS mediaMeta, c.handle
     FROM messages m JOIN contacts c ON c.id = m.conversation_id
     WHERE m.conversation_id = ? AND m.direction = 'out' AND m.kind IN ('text', 'image') AND m.status = 'sending'
       AND m.body_encrypted IS NOT NULL AND m.ciphertext_meta IS NOT NULL
     ORDER BY m.sent_at`,
    [conversationId],
  );
  return result.rows as unknown as PendingOutboundSealed[];
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
  // Image bodies are multi hundred KB base64 strings; the chats list never renders them
  // (image previews are a localized label), so exclude them from the row.
  const result = await getDb().execute(
    `SELECT m.conversation_id, CASE WHEN m.kind = 'image' THEN NULL ELSE m.body_encrypted END AS body, m.direction, m.kind, m.sent_at,
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

// Drop every message row of one conversation (the chat lock forgot-code path: sealed
// bodies without the key are unrecoverable by design).
export async function deleteConversationMessages(conversationId: string): Promise<void> {
  await getDb().execute('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
}

// Delete messages whose expiry has passed. Returns the number removed.
export async function sweepExpired(now: number): Promise<number> {
  const result = await getDb().execute('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  return result.rowsAffected ?? 0;
}
