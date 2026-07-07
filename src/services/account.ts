// Account provisioning and loading. The identity key pair and signed prekey live in the
// encrypted Signal store; the account record (handle, display name, public identity key,
// signed prekey public parts, transport auth key pair) lives in the encrypted meta table.
// Nothing here is readable until unlock. The signed prekey public parts are persisted so
// the QR contact card can embed them without touching the Signal store.

import * as Crypto from 'expo-crypto';

import {
  generateIdentity,
  generateSignedPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  NucoSignal,
  NucoSignalStore,
  type AuthKeyPair,
} from '@/crypto';
import { bytesToBase64, base64ToBytes } from '@/crypto/bytes';
import type { SignedPreKeyPublic } from '@nuco/protocol';
import { SqliteSignalBackend } from '@/db/signal-backend';
import { getMetaJson, setMetaJson } from '@/db/repos/meta';

const SIGNED_PREKEY_ID = 1;

export interface Account {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
  signedPreKey: SignedPreKeyPublic;
  authKeyPair: AuthKeyPair;
}

interface StoredAccount {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
  signedPreKey: SignedPreKeyPublic;
  authPub: string;
  authSecret: string;
}

let signal: NucoSignal | null = null;

export function getSignal(): NucoSignal {
  if (!signal) signal = new NucoSignal(new NucoSignalStore(new SqliteSignalBackend()));
  return signal;
}
export function resetSignal(): void {
  signal = null;
}

function randomHandle(): string {
  return bytesToBase64(Crypto.getRandomBytes(16)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Generate a new identity and account record. Call after the encrypted database is open.
export async function provisionAccount(displayName: string): Promise<{ account: Account }> {
  const store = new NucoSignalStore(new SqliteSignalBackend());
  const id = await generateIdentity();
  const signedPreKey = await generateSignedPreKey(id.identityKeyPair, SIGNED_PREKEY_ID);
  await installIdentity(store, id, signedPreKey);
  signal = new NucoSignal(store);

  const stored: StoredAccount = {
    handle: randomHandle(),
    displayName,
    identityKeyB64: identityPublicKeyBase64(id),
    registrationId: id.registrationId,
    signedPreKey: toSignedPreKeyPublic(signedPreKey),
    authPub: authPublicKeyBase64(id.authKeyPair),
    authSecret: bytesToBase64(id.authKeyPair.secretKey),
  };
  await setMetaJson('account', stored);

  return {
    account: {
      handle: stored.handle,
      displayName,
      identityKeyB64: stored.identityKeyB64,
      registrationId: stored.registrationId,
      signedPreKey: stored.signedPreKey,
      authKeyPair: id.authKeyPair,
    },
  };
}

export async function loadAccount(): Promise<Account | null> {
  const stored = await getMetaJson<StoredAccount>('account');
  if (!stored) return null;
  return {
    handle: stored.handle,
    displayName: stored.displayName,
    identityKeyB64: stored.identityKeyB64,
    registrationId: stored.registrationId,
    signedPreKey: stored.signedPreKey,
    authKeyPair: { publicKey: base64ToBytes(stored.authPub), secretKey: base64ToBytes(stored.authSecret) },
  };
}

// The register frame parameters for this account (used on the relay handshake). The relay
// learns only the transport auth key and push routing, never the Signal identity.
export function registerParamsFor(account: Account, push: import('@nuco/protocol').PushRegistration) {
  return {
    authKey: bytesToBase64(account.authKeyPair.publicKey),
    deviceId: 1,
    push,
  };
}

export async function setDisplayName(displayName: string): Promise<void> {
  const stored = await getMetaJson<StoredAccount>('account');
  if (!stored) return;
  await setMetaJson('account', { ...stored, displayName });
}
