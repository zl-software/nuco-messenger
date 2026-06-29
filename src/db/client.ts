// The single shared encrypted database connection. The connection is opened only after
// unlock releases the SQLCipher key, and closed on lock. op-sqlite keeps the key in the
// native connection, so locking means closing the connection (see lock-controller).

import { open, type DB } from '@op-engineering/op-sqlite';

import { migrate } from './migrations';

const DB_NAME = 'nuco.sqlite';

let connection: DB | null = null;

export async function openEncryptedDb(encryptionKey: string): Promise<DB> {
  if (connection) return connection;
  connection = open({ name: DB_NAME, encryptionKey });
  await migrate(connection);
  return connection;
}

export function getDb(): DB {
  if (!connection) throw new Error('database is locked');
  return connection;
}

export function isDbOpen(): boolean {
  return connection !== null;
}

export async function closeEncryptedDb(): Promise<void> {
  if (!connection) return;
  try {
    connection.close();
  } finally {
    connection = null;
  }
}
