// The Signal store backend backed by the encrypted database. Implements the KvBackend
// that crypto/store.ts uses, so sessions, prekeys, and the identity key pair all persist
// inside SQLCipher rather than in size limited secure storage.

import type { KvBackend } from '@/crypto/store';
import { getDb } from './client';

export class SqliteSignalBackend implements KvBackend {
  async get(key: string): Promise<string | null> {
    const result = await getDb().execute('SELECT value FROM signal_store WHERE key = ?', [key]);
    if (result.rows.length === 0) return null;
    const value = result.rows[0]!.value;
    return value === null || value === undefined ? null : String(value);
  }

  async set(key: string, value: string): Promise<void> {
    await getDb().execute(
      'INSERT INTO signal_store(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  async remove(key: string): Promise<void> {
    await getDb().execute('DELETE FROM signal_store WHERE key = ?', [key]);
  }
}
