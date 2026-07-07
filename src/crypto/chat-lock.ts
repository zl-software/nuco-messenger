// Per chat at-rest encryption for the chat lock feature. A locked chat owns a static
// X25519 keypair: the PUBLIC key seals message bodies (so incoming messages can be stored
// while the chat is locked), the PRIVATE key opens them and is released only by the chat
// code or biometrics (see lock/chat-locks.ts). Sealing is ephemeral-static ECDH -> HKDF
// SHA-256 -> AES-256-GCM, with both public keys bound into the KDF info and the row
// identity bound as GCM AAD so a ciphertext cannot be transplanted between rows or chats.
//
// This layers ON TOP of SQLCipher (which encrypts the whole database at rest) and is
// unrelated to the Signal wire encryption: bodies travel the wire through signal.ts as
// always and are sealed only for local storage. Node pure on purpose: no react-native,
// expo, or db imports, so the crypto selftest exercises this file directly.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { gcm } from '@noble/ciphers/aes.js';

import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './bytes';
import { wrapKeyWithPin, unwrapKeyWithPin, type WrappedKey } from '@/lock/pin';

const INFO_PREFIX = 'nuco-chatlock-v1';
const NONCE_LEN = 12;
const KEY_LEN = 32;
const META_VERSION = 1;

// Stored in messages.ciphertext_meta as JSON. Non-null meta is THE discriminator for "this
// row is sealed"; rows with NULL meta are plaintext and render as-is, which keeps partially
// migrated states fail safe.
interface SealedMeta {
  v: number;
  alg: string;
  epk: string; // base64 ephemeral X25519 public key
  n: string; // base64 GCM nonce
}

const ALG = 'x25519+hkdf-sha256+a256gcm';

export interface ChatLockKeys {
  privKey: Uint8Array;
  pubKeyB64: string;
}

export function generateChatLockKeys(): ChatLockKeys {
  const pair = x25519.keygen();
  return { privKey: pair.secretKey, pubKeyB64: bytesToBase64(pair.publicKey) };
}

function deriveBodyKey(shared: Uint8Array, ephPub: Uint8Array, chatPub: Uint8Array): Uint8Array {
  const info = new Uint8Array(INFO_PREFIX.length + ephPub.length + chatPub.length);
  info.set(utf8Encode(INFO_PREFIX), 0);
  info.set(ephPub, INFO_PREFIX.length);
  info.set(chatPub, INFO_PREFIX.length + ephPub.length);
  return hkdf(sha256, shared, undefined, info, KEY_LEN);
}

function rowAad(conversationId: string, messageId: string): Uint8Array {
  return utf8Encode(`${conversationId}:${messageId}`);
}

// Seal a body with the chat's public key. Needs no secret, so the receive path can store
// incoming messages while the chat is locked.
export function sealBody(
  body: string,
  chatPubB64: string,
  conversationId: string,
  messageId: string,
): { bodyB64: string; meta: string } {
  const chatPub = base64ToBytes(chatPubB64);
  const eph = x25519.keygen();
  const shared = x25519.getSharedSecret(eph.secretKey, chatPub);
  const key = deriveBodyKey(shared, eph.publicKey, chatPub);
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = gcm(key, nonce, rowAad(conversationId, messageId)).encrypt(utf8Encode(body));
  const meta: SealedMeta = {
    v: META_VERSION,
    alg: ALG,
    epk: bytesToBase64(eph.publicKey),
    n: bytesToBase64(nonce),
  };
  return { bodyB64: bytesToBase64(ciphertext), meta: JSON.stringify(meta) };
}

// Open a sealed body with the released chat private key. Throws on a wrong key, a
// tampered ciphertext, or a transplanted row (AAD mismatch).
export function openBody(
  bodyB64: string,
  metaJson: string,
  privKey: Uint8Array,
  chatPubB64: string,
  conversationId: string,
  messageId: string,
): string {
  const meta = parseMeta(metaJson);
  if (!meta) throw new Error('unsupported sealed meta');
  const ephPub = base64ToBytes(meta.epk);
  const shared = x25519.getSharedSecret(privKey, ephPub);
  const key = deriveBodyKey(shared, ephPub, base64ToBytes(chatPubB64));
  const plaintext = gcm(key, base64ToBytes(meta.n), rowAad(conversationId, messageId)).decrypt(
    base64ToBytes(bodyB64),
  );
  return utf8Decode(plaintext);
}

export function isSealed(metaJson: string | null | undefined): boolean {
  return metaJson != null && parseMeta(metaJson) !== null;
}

function parseMeta(metaJson: string): SealedMeta | null {
  try {
    const parsed = JSON.parse(metaJson) as Partial<SealedMeta>;
    if (
      parsed.v !== META_VERSION ||
      parsed.alg !== ALG ||
      typeof parsed.epk !== 'string' ||
      typeof parsed.n !== 'string'
    ) {
      return null;
    }
    return parsed as SealedMeta;
  } catch {
    return null;
  }
}

// The chat code wraps the private key with the exact same scrypt + AES-GCM construction the
// app PIN uses for the database key (lock/pin.ts). A wrong code fails the authenticated
// decryption rather than producing a key.
export async function wrapChatKeyWithCode(privKey: Uint8Array, code: string): Promise<string> {
  return JSON.stringify(await wrapKeyWithPin(privKey, code));
}

export async function unwrapChatKeyWithCode(wrappedJson: string, code: string): Promise<Uint8Array> {
  return unwrapKeyWithPin(JSON.parse(wrappedJson) as WrappedKey, code);
}
