// Identity and signed prekey generation. Produces the long term identity key pair,
// registration id, ONE signed elliptic curve prekey, ONE signed Kyber prekey (PQXDH,
// protocol 3.0), and a dedicated Ed25519 transport auth key pair. The prekeys' public
// parts go into the QR contact card (the only channel that distributes them); the full
// records are persisted only in the encrypted store and never deleted (libsignal needs
// them to answer inbound prekey messages for the account's lifetime).

import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { SignedPreKeyPublic, KyberPreKeyPublic } from '@nuco/protocol';

import type { GeneratedPreKey, KeyPairB64, LibsignalBackend } from './backend';
import { base64ToBytes, bytesToBase64 } from './bytes';
import type { NucoSignalStore } from './store';
import { STORE_FORMAT_NATIVE } from './store';

// Exactly one of each prekey exists per install, with these fixed ids.
export const SIGNED_PREKEY_ID = 1;
export const KYBER_PREKEY_ID = 1;

export interface AuthKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface IdentityMaterial {
  identityKeyPair: KeyPairB64;
  registrationId: number;
  authKeyPair: AuthKeyPair;
}

// A generated prekey together with the id it was generated under.
export interface GeneratedPreKeyWithId extends GeneratedPreKey {
  keyId: number;
}

// A Signal registration id: an opaque 14 bit value, never zero. Not key material.
function generateRegistrationId(): number {
  const bytes = randomBytes(2);
  return (((bytes[0]! << 8) | bytes[1]!) & 0x3fff) || 1;
}

export async function generateIdentity(backend: LibsignalBackend): Promise<IdentityMaterial> {
  const identityKeyPair = await backend.generateIdentityKeyPair();
  const registrationId = generateRegistrationId();
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { identityKeyPair, registrationId, authKeyPair: { publicKey, secretKey } };
}

export async function generateSignedPreKey(
  backend: LibsignalBackend,
  identityPrivateKeyB64: string,
  keyId: number,
): Promise<GeneratedPreKeyWithId> {
  return { keyId, ...(await backend.generateSignedPreKey(identityPrivateKeyB64, keyId)) };
}

export async function generateKyberPreKey(
  backend: LibsignalBackend,
  identityPrivateKeyB64: string,
  keyId: number,
): Promise<GeneratedPreKeyWithId> {
  return { keyId, ...(await backend.generateKyberPreKey(identityPrivateKeyB64, keyId)) };
}

export function toSignedPreKeyPublic(pre: GeneratedPreKeyWithId): SignedPreKeyPublic {
  return { keyId: pre.keyId, publicKey: pre.publicKey, signature: pre.signature };
}

export function toKyberPreKeyPublic(pre: GeneratedPreKeyWithId): KyberPreKeyPublic {
  return { keyId: pre.keyId, publicKey: pre.publicKey, signature: pre.signature };
}

// Persist the identity, both prekey records, and the local handle into the Signal store
// so the cipher can use them. Writes the store format marker last: its presence next to
// idkeypair is what identifies a fully provisioned native format store.
export async function installIdentity(
  store: NucoSignalStore,
  id: IdentityMaterial,
  signedPreKey: GeneratedPreKeyWithId,
  kyberPreKey: GeneratedPreKeyWithId,
  handle: string,
): Promise<void> {
  await store.setIdentityKeyPair(id.identityKeyPair);
  await store.setLocalRegistrationId(id.registrationId);
  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.record);
  await store.storeKyberPreKey(kyberPreKey.keyId, kyberPreKey.record);
  await store.setLocalHandle(handle);
  await store.setStoreFormat(STORE_FORMAT_NATIVE);
}

export function identityPublicKeyBase64(id: IdentityMaterial): string {
  return id.identityKeyPair.publicKey;
}

export function authPublicKeyBase64(authKeyPair: AuthKeyPair): string {
  return bytesToBase64(authKeyPair.publicKey);
}

// Sign the relay challenge nonce with the transport auth key (standard Ed25519).
export function signChallenge(authKeyPair: AuthKeyPair, challengeB64: string): string {
  const signature = ed25519.sign(base64ToBytes(challengeB64), authKeyPair.secretKey);
  return bytesToBase64(signature);
}
