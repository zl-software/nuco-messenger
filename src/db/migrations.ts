// Versioned schema setup. v1 creates the tables; later versions append migration steps and
// bump SCHEMA_VERSION.

import type { DB } from '@op-engineering/op-sqlite';

import { SCHEMA, SCHEMA_VERSION } from './schema';

export async function migrate(db: DB): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  for (const statement of SCHEMA) {
    await db.execute(statement);
  }
  const result = await db.execute('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const current = result.rows.length > 0 ? Number(result.rows[0]!.value) : 0;
  if (current < SCHEMA_VERSION) {
    // Future migrations between current and SCHEMA_VERSION run here.
    await db.execute(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['schema_version', String(SCHEMA_VERSION)],
    );
  }
}
