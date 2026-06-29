// Key value access to the meta table (app level values like the account record).

import { getDb } from '../client';

export async function getMeta(key: string): Promise<string | null> {
  const result = await getDb().execute('SELECT value FROM meta WHERE key = ?', [key]);
  if (result.rows.length === 0) return null;
  const value = result.rows[0]!.value;
  return value === null || value === undefined ? null : String(value);
}

export async function setMeta(key: string, value: string): Promise<void> {
  await getDb().execute('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export async function getMetaJson<T>(key: string): Promise<T | null> {
  const value = await getMeta(key);
  return value ? (JSON.parse(value) as T) : null;
}

export async function setMetaJson<T>(key: string, value: T): Promise<void> {
  await setMeta(key, JSON.stringify(value));
}
