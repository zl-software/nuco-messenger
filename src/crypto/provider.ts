// Crypto provider injection for the unaudited Signal library.
//
// The library calls a globalThis.Crypto shaped object for its symmetric crypto and
// randomness (AES-CBC, HMAC-SHA256, SHA-512 digest, getRandomValues). Hermes does not
// ship WebCrypto.subtle, so we build that object from audited pure JavaScript primitives
// (@noble/ciphers + @noble/hashes). On Node (and any runtime that already has a real
// WebCrypto) we use the native implementation directly. The Signal elliptic curve
// (X25519 plus XEd25519) is left to the library's bundled pure JavaScript curve, so we
// never hand roll Signal specific curve math.
//
// SECURITY: this whole path depends on @privacyresearch/libsignal-protocol-typescript,
// which is UNAUDITED. It must be replaced with audited native libsignal before production.

import { setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript';
import { cbc } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { u8, toArrayBuffer } from './bytes';

interface RawKey {
  raw: Uint8Array;
  algo: string;
}

const nobleSubtle = {
  async importKey(
    _format: string,
    keyData: ArrayBuffer | ArrayBufferView,
    algorithm: { name: string } | string,
  ): Promise<RawKey> {
    return { raw: u8(keyData), algo: typeof algorithm === 'string' ? algorithm : algorithm.name };
  },

  async encrypt(algorithm: { name: string; iv: ArrayBufferView }, key: RawKey, data: ArrayBuffer): Promise<ArrayBuffer> {
    const iv = u8(algorithm.iv);
    return toArrayBuffer(cbc(key.raw, iv).encrypt(u8(data)));
  },

  async decrypt(algorithm: { name: string; iv: ArrayBufferView }, key: RawKey, data: ArrayBuffer): Promise<ArrayBuffer> {
    const iv = u8(algorithm.iv);
    return toArrayBuffer(cbc(key.raw, iv).decrypt(u8(data)));
  },

  async sign(_algorithm: { name: string; hash: string }, key: RawKey, data: ArrayBuffer): Promise<ArrayBuffer> {
    return toArrayBuffer(hmac(sha256, key.raw, u8(data)));
  },

  async digest(algorithm: { name: string } | string, data: ArrayBuffer): Promise<ArrayBuffer> {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
    if (name === 'SHA-512') return toArrayBuffer(sha512(u8(data)));
    if (name === 'SHA-256') return toArrayBuffer(sha256(u8(data)));
    throw new Error(`unsupported digest algorithm ${name}`);
  },
};

const nobleCrypto = {
  getRandomValues<T extends ArrayBufferView>(array: T): T {
    const view = u8(array);
    view.set(randomBytes(view.length));
    return array;
  },
  subtle: nobleSubtle,
} as unknown as Crypto;

let installed = false;

function hasNativeSubtle(): boolean {
  const g = globalThis.crypto as Crypto | undefined;
  return !!(g && g.subtle && typeof g.subtle.importKey === 'function');
}

// Install the crypto provider once. Prefers native WebCrypto when present (Node), otherwise
// uses the audited pure JavaScript provider (Hermes).
export function installCryptoProvider(): void {
  if (installed) return;
  setWebCrypto(hasNativeSubtle() ? (globalThis.crypto as Crypto) : nobleCrypto);
  installed = true;
}

// Force the pure JavaScript provider regardless of environment. Used by the crypto self
// test so the exact Hermes path is exercised on Node.
export function installNobleProvider(): void {
  setWebCrypto(nobleCrypto);
  installed = true;
}

// Force native WebCrypto. Used by the crypto self test on Node. Throws if unavailable.
export function installNativeProvider(): void {
  if (!hasNativeSubtle()) throw new Error('native WebCrypto.subtle is not available');
  setWebCrypto(globalThis.crypto as Crypto);
  installed = true;
}
