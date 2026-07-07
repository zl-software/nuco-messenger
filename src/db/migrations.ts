// Versioned schema setup. v1 creates the tables; later versions append migration steps and
// bump SCHEMA_VERSION.

import type { DB } from '@op-engineering/op-sqlite';

import { SCHEMA, SCHEMA_VERSION } from './schema';

async function columnExists(db: DB, table: string, column: string): Promise<boolean> {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  return (result.rows as unknown as Array<{ name: string }>).some((r) => r.name === column);
}

export async function migrate(db: DB): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  for (const statement of SCHEMA) {
    await db.execute(statement);
  }
  const result = await db.execute('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const current = result.rows.length > 0 ? Number(result.rows[0]!.value) : 0;
  if (current < SCHEMA_VERSION) {
    // v1 -> v2: track whether a pending retention change was requested by us or the peer. Fresh
    // databases already have the column from SCHEMA, so only add it where it is missing.
    if (current < 2 && !(await columnExists(db, 'conversations', 'retention_pending_incoming'))) {
      await db.execute('ALTER TABLE conversations ADD COLUMN retention_pending_incoming INTEGER NOT NULL DEFAULT 0');
    }
    // v2 -> v3: message kind distinguishes text from retention system messages.
    if (current < 3 && !(await columnExists(db, 'messages', 'kind'))) {
      await db.execute("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
    }
    // v3 -> v4: mutual verification. Both timestamps set = conversation unlocked;
    // card_spk_pub is the peer's signed prekey public key from their scanned card,
    // needed to recompute the cardHash proof at confirm time.
    if (current < 4 && !(await columnExists(db, 'contacts', 'local_confirmed_at'))) {
      await db.execute('ALTER TABLE contacts ADD COLUMN local_confirmed_at INTEGER');
      await db.execute('ALTER TABLE contacts ADD COLUMN peer_confirmed_at INTEGER');
      await db.execute('ALTER TABLE contacts ADD COLUMN card_spk_pub TEXT');
    }
    // v4 -> v5: per chat screenshot protection, negotiated like retention.
    if (current < 5 && !(await columnExists(db, 'conversations', 'screenshot_protection'))) {
      await db.execute('ALTER TABLE conversations ADD COLUMN screenshot_protection INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE conversations ADD COLUMN screenshot_pending INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE conversations ADD COLUMN screenshot_pending_value INTEGER');
      await db.execute('ALTER TABLE conversations ADD COLUMN screenshot_pending_incoming INTEGER NOT NULL DEFAULT 0');
    }
    // v5 -> v6: local per chat lock (not negotiated with the peer). The pubkey seals
    // bodies at rest; the private key lives wrapped in SecureStore (lock/chat-locks.ts).
    if (current < 6 && !(await columnExists(db, 'conversations', 'lock_enabled'))) {
      await db.execute('ALTER TABLE conversations ADD COLUMN lock_enabled INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE conversations ADD COLUMN lock_bio_enabled INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE conversations ADD COLUMN lock_pubkey TEXT');
      await db.execute('ALTER TABLE conversations ADD COLUMN lock_failed_attempts INTEGER NOT NULL DEFAULT 0');
      await db.execute('ALTER TABLE conversations ADD COLUMN lock_lockout_until INTEGER NOT NULL DEFAULT 0');
    }
    // v6 -> v7: reply references. reply_to_id carries the shared message id of the quoted
    // text (both peers key a text by the same envelope id). Deliberately no FK: the
    // referenced row may already be gone; the UI resolves it best effort at render.
    if (current < 7 && !(await columnExists(db, 'messages', 'reply_to_id'))) {
      await db.execute('ALTER TABLE messages ADD COLUMN reply_to_id TEXT');
    }
    await db.execute(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['schema_version', String(SCHEMA_VERSION)],
    );
  }
}
