// PIN handling. The PIN is never the database key. It derives a wrapping key (scrypt over
// a random salt) that encrypts a copy of the random database key, so the PIN can release
// the database key as a fallback when biometrics are unavailable or the biometric set has
// changed. A wrong PIN fails the authenticated decryption rather than producing a key.

import { scrypt } from '@noble/hashes/scrypt.js';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { bytesToBase64, base64ToBytes, utf8Encode } from '@/crypto/bytes';

const SCRYPT_N = 1 << 14; // 16384, a balance for on device unlock
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;

export interface WrappedKey {
  wrapped: string; // base64 of nonce || ciphertext
  salt: string; // base64
}

function deriveWrappingKey(pin: string, salt: Uint8Array): Uint8Array {
  return scrypt(utf8Encode(pin), salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: KEY_LEN });
}

// Wrap the raw database key with a PIN derived key.
export function wrapKeyWithPin(dbKey: Uint8Array, pin: string): WrappedKey {
  const salt = randomBytes(SALT_LEN);
  const wrappingKey = deriveWrappingKey(pin, salt);
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = gcm(wrappingKey, nonce).encrypt(dbKey);
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return { wrapped: bytesToBase64(blob), salt: bytesToBase64(salt) };
}

// Unwrap the database key. Throws if the PIN is wrong (GCM authentication fails).
export function unwrapKeyWithPin(wrapped: WrappedKey, pin: string): Uint8Array {
  const wrappingKey = deriveWrappingKey(pin, base64ToBytes(wrapped.salt));
  const blob = base64ToBytes(wrapped.wrapped);
  const nonce = blob.slice(0, NONCE_LEN);
  const ciphertext = blob.slice(NONCE_LEN);
  return gcm(wrappingKey, nonce).decrypt(ciphertext);
}
