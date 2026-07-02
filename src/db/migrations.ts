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
    await db.execute(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['schema_version', String(SCHEMA_VERSION)],
    );
  }
}
