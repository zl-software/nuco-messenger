// The single shared encrypted database connection. The connection is opened only after
// unlock releases the SQLCipher key, and closed on lock. op-sqlite keeps the key in the
// native connection, so locking means closing the connection (see lock-controller).

import { Platform } from 'react-native';
import { open, IOS_LIBRARY_PATH, ANDROID_DATABASE_PATH, type DB } from '@op-engineering/op-sqlite';
import { File } from 'expo-file-system';

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

// Whether the encrypted database file exists on disk, checked WITHOUT opening it (op-sqlite's
// open() would create the file). The path mirrors what open({ name }) uses: the iOS Library
// directory or Android's databases directory. Used by the reinstall guard, which must never
// wipe a real account, so any error reports the file as present.
export function databaseFileExists(): boolean {
  const dir = Platform.OS === 'ios' ? IOS_LIBRARY_PATH : ANDROID_DATABASE_PATH;
  const sep = dir.endsWith('/') ? '' : '/';
  try {
    return new File(`file://${dir}${sep}${DB_NAME}`).exists;
  } catch {
    return true;
  }
}

// Delete the encrypted database file. Needed before provisioning a fresh account, because
// SQLCipher cannot reopen an existing file with a new key, and for the dev reset.
export async function deleteDatabaseFile(): Promise<void> {
  await closeEncryptedDb();
  try {
    // open() does not verify the key (SQLCipher checks it on first query), so this handle is
    // valid just to delete the file.
    open({ name: DB_NAME, encryptionKey: 'delete' }).delete();
  } catch {
    // No file to delete.
  }
}
