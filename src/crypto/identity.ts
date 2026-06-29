// Identity and prekey generation. Produces the long term identity key pair, registration
// id, signed prekey, a batch of one time prekeys, and a dedicated Ed25519 transport auth
// key pair. Public parts become the prekey upload and the QR contact card; private parts
// are persisted only in the encrypted store.

import {
  KeyHelper,
  type KeyPairType,
  type SignedPreKeyPairType,
  type PreKeyPairType,
} from '@privacyresearch/libsignal-protocol-typescript';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { PreKeyUpload, SignedPreKeyPublic, OneTimePreKeyPublic } from '@nuco/protocol';

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

export interface PreKeyMaterial {
  signedPreKey: SignedPreKeyPairType;
  oneTimePreKeys: PreKeyPairType[];
}

export async function generateIdentity(): Promise<IdentityMaterial> {
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { identityKeyPair, registrationId, authKeyPair: { publicKey, secretKey } };
}

export async function generatePreKeys(
  identityKeyPair: KeyPairType,
  signedKeyId: number,
  startId: number,
  count: number,
): Promise<PreKeyMaterial> {
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedKeyId);
  const oneTimePreKeys: PreKeyPairType[] = [];
  for (let i = 0; i < count; i++) {
    oneTimePreKeys.push(await KeyHelper.generatePreKey(startId + i));
  }
  return { signedPreKey, oneTimePreKeys };
}

export function toUploadBundle(pre: PreKeyMaterial): PreKeyUpload {
  const signedPreKey: SignedPreKeyPublic = {
    keyId: pre.signedPreKey.keyId,
    publicKey: abToBase64(pre.signedPreKey.keyPair.pubKey),
    signature: abToBase64(pre.signedPreKey.signature),
  };
  const oneTimePreKeys: OneTimePreKeyPublic[] = pre.oneTimePreKeys.map((k) => ({
    keyId: k.keyId,
    publicKey: abToBase64(k.keyPair.pubKey),
  }));
  return { signedPreKey, oneTimePreKeys };
}

// Persist identity and prekeys into the Signal store so the cipher can use them.
export async function installIdentity(
  store: NucoSignalStore,
  id: IdentityMaterial,
  pre: PreKeyMaterial,
): Promise<void> {
  await store.setIdentityKeyPair(id.identityKeyPair);
  await store.setLocalRegistrationId(id.registrationId);
  await store.storeSignedPreKey(pre.signedPreKey.keyId, pre.signedPreKey.keyPair);
  for (const k of pre.oneTimePreKeys) {
    await store.storePreKey(k.keyId, k.keyPair);
  }
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
