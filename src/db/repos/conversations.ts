// Conversations repository. One conversation per contact.

import { getDb } from '../client';

export interface Conversation {
  id: string;
  contactId: string;
  retentionSeconds: number;
  retentionPending: boolean;
  retentionPendingValue: number | null;
  retentionPendingIncoming: boolean;
  screenshotProtection: boolean;
  screenshotPending: boolean;
  screenshotPendingValue: boolean | null;
  screenshotPendingIncoming: boolean;
  lockEnabled: boolean;
  lockBioEnabled: boolean;
  lockPubkey: string | null;
  lockFailedAttempts: number;
  lockLockoutUntil: number;
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
  screenshot_protection: number;
  screenshot_pending: number;
  screenshot_pending_value: number | null;
  screenshot_pending_incoming: number;
  lock_enabled: number;
  lock_bio_enabled: number;
  lock_pubkey: string | null;
  lock_failed_attempts: number;
  lock_lockout_until: number;
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
    screenshotProtection: r.screenshot_protection === 1,
    screenshotPending: r.screenshot_pending === 1,
    screenshotPendingValue: r.screenshot_pending_value == null ? null : r.screenshot_pending_value === 1,
    screenshotPendingIncoming: r.screenshot_pending_incoming === 1,
    lockEnabled: r.lock_enabled === 1,
    lockBioEnabled: r.lock_bio_enabled === 1,
    lockPubkey: r.lock_pubkey,
    lockFailedAttempts: r.lock_failed_attempts,
    lockLockoutUntil: r.lock_lockout_until,
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
  // INSERT OR IGNORE so two concurrent receives for the same contact (which pass the same id)
  // do not throw a PRIMARY KEY violation and drop a message. The insert is idempotent; the row
  // below is authoritative whether we won the race or another caller did.
  await getDb().execute(
    'INSERT OR IGNORE INTO conversations (id, contact_id, retention_seconds, retention_pending, retention_pending_value, retention_pending_incoming, muted, created_at) VALUES (?, ?, ?, 0, NULL, 0, 0, ?)',
    [id, contactId, retentionSeconds, now],
  );
  const row = await getConversationByContact(contactId);
  if (row) return row;
  return {
    id,
    contactId,
    retentionSeconds,
    retentionPending: false,
    retentionPendingValue: null,
    retentionPendingIncoming: false,
    screenshotProtection: false,
    screenshotPending: false,
    screenshotPendingValue: null,
    screenshotPendingIncoming: false,
    lockEnabled: false,
    lockBioEnabled: false,
    lockPubkey: null,
    lockFailedAttempts: 0,
    lockLockoutUntil: 0,
    muted: false,
    createdAt: now,
  };
}

// Delete a conversation and (via the FK cascade) all its messages. The contact survives:
// deleting a chat is not deleting the person, and the next message recreates the row with
// defaults through ensureConversation. Chat lock SecureStore items do not cascade; callers
// remove them explicitly (lock/chat-locks.ts removeChatLockSecrets).
export async function deleteConversation(id: string): Promise<void> {
  await getDb().execute('DELETE FROM conversations WHERE id = ?', [id]);
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

export async function setScreenshotProtection(id: string, on: boolean): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET screenshot_protection = ?, screenshot_pending = 0, screenshot_pending_value = NULL, screenshot_pending_incoming = 0 WHERE id = ?',
    [on ? 1 : 0, id],
  );
}

// A pending screenshot protection change. `incoming` is true when the peer requested it (we
// accept or decline), false when we requested it (we wait or cancel).
export async function setScreenshotPending(id: string, pendingOn: boolean, incoming: boolean): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET screenshot_pending = 1, screenshot_pending_value = ?, screenshot_pending_incoming = ? WHERE id = ?',
    [pendingOn ? 1 : 0, incoming ? 1 : 0, id],
  );
}

export async function clearScreenshotPending(id: string): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET screenshot_pending = 0, screenshot_pending_value = NULL, screenshot_pending_incoming = 0 WHERE id = ?',
    [id],
  );
}

export async function setConversationMuted(id: string, muted: boolean): Promise<void> {
  await getDb().execute('UPDATE conversations SET muted = ? WHERE id = ?', [muted ? 1 : 0, id]);
}

// The per chat lock is local only (never negotiated with the peer). Enabling stores the
// sealing pubkey; disabling clears it together with the attempt counters.
export async function setChatLock(
  id: string,
  state: { enabled: boolean; bioEnabled: boolean; pubkey: string | null },
): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET lock_enabled = ?, lock_bio_enabled = ?, lock_pubkey = ?, lock_failed_attempts = 0, lock_lockout_until = 0 WHERE id = ?',
    [state.enabled ? 1 : 0, state.bioEnabled ? 1 : 0, state.pubkey, id],
  );
}

export async function setChatLockBio(id: string, on: boolean): Promise<void> {
  await getDb().execute('UPDATE conversations SET lock_bio_enabled = ? WHERE id = ?', [on ? 1 : 0, id]);
}

// Persisted (not in memory) so a force quit cannot reset the per chat lockout.
export async function setChatLockAttempts(id: string, attempts: number, lockoutUntil: number): Promise<void> {
  await getDb().execute(
    'UPDATE conversations SET lock_failed_attempts = ?, lock_lockout_until = ? WHERE id = ?',
    [attempts, lockoutUntil, id],
  );
}

// All conversations whose chat lock is on, for the boot time self heal pass (sealing rows
// that were inserted plaintext by a crash mid enable needs only the pubkey, no auth).
export async function listLockedConversations(): Promise<Conversation[]> {
  const result = await getDb().execute('SELECT * FROM conversations WHERE lock_enabled = 1');
  return (result.rows as unknown as ConversationRow[]).map(toConversation);
}
