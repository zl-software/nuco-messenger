// Hardware backed secret storage (expo-secure-store, iOS Keychain / Android Keystore).
// It holds only small keys, never the Signal store or messages (which live in the
// encrypted SQLCipher database).
//
// The random 32 byte database key is stored two ways:
//  - a biometric gated copy (requireAuthentication), released by the OS after Face ID /
//    fingerprint / device credential. This is the fast unlock path.
//  - a PIN wrapped copy (encrypted by a scrypt derived key, see lock/pin.ts), the fallback
//    when biometrics are unavailable or the biometric set changed (which invalidates the
//    requireAuthentication entry).
// The PIN never derives the database key directly.

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

import { bytesToBase64, base64ToBytes } from './bytes';
import { wrapKeyWithPin, unwrapKeyWithPin, type WrappedKey } from '@/lock/pin';

const DB_KEY_BIO = 'nuco.dbkey.bio';
const DB_KEY_PIN = 'nuco.dbkey.pin';

const DEVICE_BOUND = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
} as const;

// Generate the database key once at onboarding. Returns it (base64) so the caller can open
// the encrypted database immediately, and stores the biometric gated copy.
export async function provisionDatabaseKey(): Promise<string> {
  const raw = Crypto.getRandomBytes(32);
  const keyB64 = bytesToBase64(raw);
  await SecureStore.setItemAsync(DB_KEY_BIO, keyB64, {
    ...DEVICE_BOUND,
    requireAuthentication: true,
  });
  return keyB64;
}

// Read the database key via the OS biometric / device credential prompt.
export async function getDatabaseKeyWithBiometrics(prompt: string): Promise<string | null> {
  return SecureStore.getItemAsync(DB_KEY_BIO, {
    ...DEVICE_BOUND,
    requireAuthentication: true,
    authenticationPrompt: prompt,
  });
}

// Store (or replace) the PIN wrapped copy of the database key.
export async function setPinWrappedKey(dbKeyB64: string, pin: string): Promise<void> {
  const wrapped = await wrapKeyWithPin(base64ToBytes(dbKeyB64), pin);
  await SecureStore.setItemAsync(DB_KEY_PIN, JSON.stringify(wrapped), DEVICE_BOUND);
}

// Release the database key by verifying the PIN. Throws on a wrong PIN.
export async function getDatabaseKeyWithPin(pin: string): Promise<string> {
  const json = await SecureStore.getItemAsync(DB_KEY_PIN, DEVICE_BOUND);
  if (!json) throw new Error('no PIN wrapped key');
  const wrapped = JSON.parse(json) as WrappedKey;
  return bytesToBase64(await unwrapKeyWithPin(wrapped, pin));
}

export async function changePin(oldPin: string, newPin: string): Promise<void> {
  const dbKeyB64 = await getDatabaseKeyWithPin(oldPin);
  await setPinWrappedKey(dbKeyB64, newPin);
}

export async function hasDatabaseKey(): Promise<boolean> {
  return (await SecureStore.getItemAsync(DB_KEY_PIN, DEVICE_BOUND)) !== null;
}

// Wipe all key material. The encrypted database becomes permanently unrecoverable.
export async function wipeSecrets(): Promise<void> {
  await SecureStore.deleteItemAsync(DB_KEY_BIO, DEVICE_BOUND);
  await SecureStore.deleteItemAsync(DB_KEY_PIN, DEVICE_BOUND);
}
