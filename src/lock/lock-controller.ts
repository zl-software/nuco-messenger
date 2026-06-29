// The app lock. It gates DECRYPTION, not just the UI: the SQLCipher key lives only in this
// module's memory, the encrypted database is opened only after unlock, and locking closes
// the connection and drops the key. On cold start nothing is decrypted until unlock, and on
// background return past the auto lock timeout the database is closed and re auth required.
//
// JavaScript strings cannot be truly zeroed, so dropping the reference is the best we can
// do for the in memory key; the durable protection is that the key never leaves the
// hardware keystore except briefly in memory after an explicit unlock.

import { AppState, type AppStateStatus } from 'react-native';

import { openEncryptedDb, closeEncryptedDb } from '@/db/client';
import { getDatabaseKeyWithBiometrics, getDatabaseKeyWithPin } from '@/crypto/secure-storage';

export type LockStatus = 'locked' | 'unlocking' | 'unlocked';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60_000;

let dbKey: string | null = null;
let status: LockStatus = 'locked';
let backgroundedAt: number | null = null;
let autoLockMs = 60_000;
let failedAttempts = 0;
let lockoutUntil = 0;

const listeners = new Set<(s: LockStatus) => void>();

function setStatus(next: LockStatus): void {
  status = next;
  for (const listener of listeners) listener(next);
}

export function subscribeLock(fn: (s: LockStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLockStatus(): LockStatus {
  return status;
}
export function isUnlocked(): boolean {
  return dbKey !== null && status === 'unlocked';
}
export function setAutoLockMs(ms: number): void {
  autoLockMs = ms;
}
export function failedAttemptsRemaining(): number {
  return Math.max(0, MAX_ATTEMPTS - failedAttempts);
}
export function lockoutRemainingMs(): number {
  return Math.max(0, lockoutUntil - Date.now());
}

async function openWithKey(keyB64: string): Promise<void> {
  await openEncryptedDb(keyB64);
  dbKey = keyB64;
  failedAttempts = 0;
  setStatus('unlocked');
}

export async function unlockWithBiometrics(prompt: string): Promise<boolean> {
  if (lockoutRemainingMs() > 0) return false;
  setStatus('unlocking');
  try {
    const key = await getDatabaseKeyWithBiometrics(prompt);
    if (!key) {
      setStatus('locked');
      return false;
    }
    await openWithKey(key);
    return true;
  } catch {
    setStatus('locked');
    return false;
  }
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  if (lockoutRemainingMs() > 0) return false;
  setStatus('unlocking');
  try {
    const key = await getDatabaseKeyWithPin(pin); // throws on wrong PIN
    await openWithKey(key);
    return true;
  } catch {
    failedAttempts += 1;
    if (failedAttempts >= MAX_ATTEMPTS) {
      lockoutUntil = Date.now() + LOCKOUT_MS;
      failedAttempts = 0;
    }
    setStatus('locked');
    return false;
  }
}

// Used right after onboarding provisions and opens the database with a fresh key.
export function markUnlockedWithKey(keyB64: string): void {
  dbKey = keyB64;
  setStatus('unlocked');
}

export async function lock(): Promise<void> {
  dbKey = null;
  await closeEncryptedDb();
  backgroundedAt = null;
  setStatus('locked');
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background' || next === 'inactive') {
    if (backgroundedAt === null) backgroundedAt = Date.now();
  } else if (next === 'active') {
    if (backgroundedAt !== null && Date.now() - backgroundedAt > autoLockMs) {
      void lock();
    }
    backgroundedAt = null;
  }
}

let subscription: { remove(): void } | null = null;
export function attachAppStateGate(): void {
  if (subscription) return;
  subscription = AppState.addEventListener('change', onAppStateChange);
}
export function detachAppStateGate(): void {
  subscription?.remove();
  subscription = null;
}
