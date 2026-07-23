// Staging for in flight incoming images (protocol 3.3). One transfer row per `image`
// announcement plus one chunk row per received `image/chunk`; everything is protected at
// rest by SQLCipher. When the last chunk lands the caller assembles and verifies the
// image into a messages row (id = ref) and deletes the transfer; incomplete transfers are
// garbage collected by the expiry sweeper. Both inserts are INSERT OR IGNORE so relay
// redelivery is a no-op.

import { getDb } from '../client';

export interface ImageTransfer {
  ref: string;
  conversationId: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  chunksTotal: number;
  sentAt: number;
  createdAt: number;
}

interface TransferRow {
  ref: string;
  conversation_id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  chunks_total: number;
  sent_at: number;
  created_at: number;
}

function toTransfer(r: TransferRow): ImageTransfer {
  return {
    ref: r.ref,
    conversationId: r.conversation_id,
    mime: r.mime,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    sha256: r.sha256,
    chunksTotal: r.chunks_total,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

export async function createTransfer(t: ImageTransfer): Promise<void> {
  await getDb().execute(
    `INSERT OR IGNORE INTO image_transfers (ref, conversation_id, mime, width, height, bytes, sha256, chunks_total, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.ref, t.conversationId, t.mime, t.width, t.height, t.bytes, t.sha256, t.chunksTotal, t.sentAt, t.createdAt],
  );
}

export async function getTransfer(ref: string): Promise<ImageTransfer | null> {
  const result = await getDb().execute('SELECT * FROM image_transfers WHERE ref = ?', [ref]);
  const row = result.rows[0] as unknown as TransferRow | undefined;
  return row ? toTransfer(row) : null;
}

export async function insertChunk(ref: string, seq: number, data: string): Promise<void> {
  await getDb().execute('INSERT OR IGNORE INTO image_chunks (ref, seq, data) VALUES (?, ?, ?)', [ref, seq, data]);
}

export async function chunkCount(ref: string): Promise<number> {
  const result = await getDb().execute('SELECT COUNT(*) AS n FROM image_chunks WHERE ref = ?', [ref]);
  return Number((result.rows[0] as unknown as { n: number }).n);
}

// The received chunk data in seq order, for assembly.
export async function listChunkData(ref: string): Promise<string[]> {
  const result = await getDb().execute('SELECT data FROM image_chunks WHERE ref = ? ORDER BY seq', [ref]);
  return (result.rows as unknown as Array<{ data: string }>).map((r) => r.data);
}

export async function deleteTransfer(ref: string): Promise<void> {
  // The chunk rows cascade from the transfer row.
  await getDb().execute('DELETE FROM image_transfers WHERE ref = ?', [ref]);
}

// Scoped variant for the message/delete receive path: the conversation predicate stops a
// ref replayed from another chat from killing an unrelated transfer.
export async function deleteConversationTransfer(ref: string, conversationId: string): Promise<void> {
  await getDb().execute('DELETE FROM image_transfers WHERE ref = ? AND conversation_id = ?', [ref, conversationId]);
}

// In flight transfers of one conversation with their received chunk counts, for the
// progress placeholder bubbles.
export interface ActiveTransfer extends ImageTransfer {
  received: number;
}

export async function listActiveTransfers(conversationId: string): Promise<ActiveTransfer[]> {
  const result = await getDb().execute(
    `SELECT t.*, (SELECT COUNT(*) FROM image_chunks c WHERE c.ref = t.ref) AS received
     FROM image_transfers t WHERE t.conversation_id = ? ORDER BY t.sent_at`,
    [conversationId],
  );
  return (result.rows as unknown as Array<TransferRow & { received: number }>).map((r) => ({
    ...toTransfer(r),
    received: Number(r.received),
  }));
}

// Garbage collection for transfers whose sender gave up (or whose tail the queue TTL
// expired). Returns the number removed.
export async function sweepStaleTransfers(cutoff: number): Promise<number> {
  const result = await getDb().execute('DELETE FROM image_transfers WHERE created_at < ?', [cutoff]);
  return result.rowsAffected ?? 0;
}

// Blocking a contact stops future envelopes before decrypt, but a half received transfer
// would otherwise linger until the GC; drop it immediately.
export async function purgeTransfersForConversation(conversationId: string): Promise<void> {
  await getDb().execute('DELETE FROM image_transfers WHERE conversation_id = ?', [conversationId]);
}
