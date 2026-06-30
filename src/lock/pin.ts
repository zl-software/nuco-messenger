// PIN handling. The PIN is never the database key. It derives a wrapping key (scrypt over
// a random salt) that encrypts a copy of the random database key, so the PIN can release
// the database key as a fallback when biometrics are unavailable or the biometric set has
// changed. A wrong PIN fails the authenticated decryption rather than producing a key.
//
// scrypt runs through scryptAsync so it yields to the UI thread instead of freezing the app
// while the key is derived.

import { scryptAsync } from '@noble/hashes/scrypt.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { bytesToBase64, base64ToBytes, utf8Encode } from '@/crypto/bytes';

// scrypt cost for new wrapped keys. A 6 digit PIN's real defenses are the hardware secure
// store holding this blob and the attempt lockout, not the work factor, so this is tuned for a
// fast on device unlock (pure JS scrypt on Hermes is slow at higher N).
const SCRYPT_N = 1 << 12; // 4096
// Wrapped keys written before the cost was lowered carry no `n`; derive them at the old value
// so an existing PIN keeps unlocking (it speeds up once the PIN is set again).
const LEGACY_SCRYPT_N = 1 << 14; // 16384
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;

export interface WrappedKey {
  wrapped: string; // base64 of nonce || ciphertext
  salt: string; // base64
  n?: number; // scrypt cost used; absent on legacy blobs (treated as LEGACY_SCRYPT_N)
}

function deriveWrappingKey(pin: string, salt: Uint8Array, n: number): Promise<Uint8Array> {
  return scryptAsync(utf8Encode(pin), salt, { N: n, r: SCRYPT_R, p: SCRYPT_P, dkLen: KEY_LEN });
}

// Wrap the raw database key with a PIN derived key.
export async function wrapKeyWithPin(dbKey: Uint8Array, pin: string): Promise<WrappedKey> {
  const salt = randomBytes(SALT_LEN);
  const wrappingKey = await deriveWrappingKey(pin, salt, SCRYPT_N);
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = gcm(wrappingKey, nonce).encrypt(dbKey);
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return { wrapped: bytesToBase64(blob), salt: bytesToBase64(salt), n: SCRYPT_N };
}

// Unwrap the database key. Throws if the PIN is wrong (GCM authentication fails).
export async function unwrapKeyWithPin(wrapped: WrappedKey, pin: string): Promise<Uint8Array> {
  const n = wrapped.n ?? LEGACY_SCRYPT_N;
  const wrappingKey = await deriveWrappingKey(pin, base64ToBytes(wrapped.salt), n);
  const blob = base64ToBytes(wrapped.wrapped);
  const nonce = blob.slice(0, NONCE_LEN);
  const ciphertext = blob.slice(NONCE_LEN);
  return gcm(wrappingKey, nonce).decrypt(ciphertext);
}
