// Identity and signed prekey generation. Produces the long term identity key pair,
// registration id, ONE signed prekey, and a dedicated Ed25519 transport auth key pair.
// The signed prekey's public parts go into the QR contact card (the only channel that
// distributes it since protocol 2.0); private parts are persisted only in the encrypted
// store, and the signed prekey private key is never deleted (the Signal library needs it
// to answer inbound prekey messages for the account's lifetime).

import {
  KeyHelper,
  type KeyPairType,
  type SignedPreKeyPairType,
} from '@privacyresearch/libsignal-protocol-typescript';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { SignedPreKeyPublic } from '@nuco/protocol';

import { abToBase64, base64ToBytes, bytesToBase64 } from './bytes';
import type { NucoSignalStore } from './store';

export interface AuthKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface IdentityMaterial {
  identityKeyPair: KeyPairType;
  registrationId: number;
  authKeyPair: AuthKeyPair;
}

export async function generateIdentity(): Promise<IdentityMaterial> {
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { identityKeyPair, registrationId, authKeyPair: { publicKey, secretKey } };
}

export async function generateSignedPreKey(
  identityKeyPair: KeyPairType,
  keyId: number,
): Promise<SignedPreKeyPairType> {
  return KeyHelper.generateSignedPreKey(identityKeyPair, keyId);
}

export function toSignedPreKeyPublic(pre: SignedPreKeyPairType): SignedPreKeyPublic {
  return {
    keyId: pre.keyId,
    publicKey: abToBase64(pre.keyPair.pubKey),
    signature: abToBase64(pre.signature),
  };
}

// Persist identity and the signed prekey into the Signal store so the cipher can use them.
export async function installIdentity(
  store: NucoSignalStore,
  id: IdentityMaterial,
  signedPreKey: SignedPreKeyPairType,
): Promise<void> {
  await store.setIdentityKeyPair(id.identityKeyPair);
  await store.setLocalRegistrationId(id.registrationId);
  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
}

export function identityPublicKeyBase64(id: IdentityMaterial): string {
  return abToBase64(id.identityKeyPair.pubKey);
}

export function authPublicKeyBase64(authKeyPair: AuthKeyPair): string {
  return bytesToBase64(authKeyPair.publicKey);
}

// Sign the relay challenge nonce with the transport auth key (standard Ed25519).
export function signChallenge(authKeyPair: AuthKeyPair, challengeB64: string): string {
  const signature = ed25519.sign(base64ToBytes(challengeB64), authKeyPair.secretKey);
  return bytesToBase64(signature);
}
