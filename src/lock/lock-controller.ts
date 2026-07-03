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
import {
  getDatabaseKeyWithBiometrics,
  getDatabaseKeyWithPin,
  loadLockoutState,
  saveLockoutState,
} from '@/crypto/secure-storage';

export type LockStatus = 'locked' | 'unlocking' | 'unlocked';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60_000;

let dbKey: string | null = null;
let status: LockStatus = 'locked';
let backgroundedAt: number | null = null;
let autoLockMs = 60_000;
let failedAttempts = 0;
let lockoutUntil = 0;

// The lockout counters are persisted so they survive a force quit. Hydrate them from secure
// storage before the first unlock attempt reads them, so killing the app cannot reset the
// lockout.
let lockoutHydrated = false;
let hydrating: Promise<void> | null = null;

function ensureLockoutHydrated(): Promise<void> {
  if (lockoutHydrated) return Promise.resolve();
  if (!hydrating) {
    hydrating = (async () => {
      const state = await loadLockoutState();
      if (state) {
        failedAttempts = state.failedAttempts;
        lockoutUntil = state.lockoutUntil;
      }
      lockoutHydrated = true;
    })();
  }
  return hydrating;
}

function persistLockout(): void {
  void saveLockoutState({ failedAttempts, lockoutUntil }).catch(() => undefined);
}

// An active call defers the AUTO lock only (an explicit lock always wins): the call
// service registers a predicate here. Injected as a callback so this module stays free of
// call imports and the lock design stays auditable in one file.
let autoLockDeferral: (() => boolean) | null = null;
export function setAutoLockDeferral(fn: (() => boolean) | null): void {
  autoLockDeferral = fn;
}

// Runs at the start of lock(), while the db key is still alive, so an in flight call can
// seal its end signal and write its summary row. It can only delay the lock briefly (the
// hook bounds its own waits) and can never veto it.
let preLockHook: (() => Promise<void>) | null = null;
export function setPreLockHook(fn: (() => Promise<void>) | null): void {
  preLockHook = fn;
}

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
  lockoutUntil = 0;
  persistLockout();
  setStatus('unlocked');
}

export async function unlockWithBiometrics(prompt: string): Promise<boolean> {
  await ensureLockoutHydrated();
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
  await ensureLockoutHydrated();
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
    persistLockout();
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
  if (preLockHook) {
    try {
      await preLockHook();
    } catch {
      // Cleanup must never block the lock.
    }
  }
  dbKey = null;
  await closeEncryptedDb();
  backgroundedAt = null;
  setStatus('locked');
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background' || next === 'inactive') {
    if (backgroundedAt === null) backgroundedAt = Date.now();
  } else if (next === 'active') {
    if (backgroundedAt !== null && Date.now() - backgroundedAt > autoLockMs && !(autoLockDeferral?.() ?? false)) {
      void lock();
    }
    backgroundedAt = null;
  }
}

let subscription: { remove(): void } | null = null;
export function attachAppStateGate(): void {
  if (subscription) return;
  // Load the persisted lockout early so the lock screen reflects it without waiting for the
  // first unlock attempt (which also awaits hydration as a backstop).
  void ensureLockoutHydrated();
  subscription = AppState.addEventListener('change', onAppStateChange);
}
export function detachAppStateGate(): void {
  subscription?.remove();
  subscription = null;
}
