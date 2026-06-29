// Account provisioning and loading. The identity key pair and prekeys live in the encrypted
// Signal store; the account record (handle, display name, public identity key, transport
// auth key pair) lives in the encrypted meta table. Nothing here is readable until unlock.

import * as Crypto from 'expo-crypto';

import {
  generateIdentity,
  generatePreKeys,
  installIdentity,
  toUploadBundle,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  NucoSignal,
  NucoSignalStore,
  type AuthKeyPair,
} from '@/crypto';
import { bytesToBase64, base64ToBytes } from '@/crypto/bytes';
import type { PreKeyUpload } from '@nuco/protocol';
import { SqliteSignalBackend } from '@/db/signal-backend';
import { getMetaJson, setMetaJson } from '@/db/repos/meta';

const ONE_TIME_PREKEY_COUNT = 20;

export interface Account {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
  authKeyPair: AuthKeyPair;
}

interface StoredAccount {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
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

// Generate a new identity and account record. Returns the account plus the prekey upload to
// publish to the relay. Call after the encrypted database is open.
export async function provisionAccount(displayName: string): Promise<{ account: Account; upload: PreKeyUpload }> {
  const store = new NucoSignalStore(new SqliteSignalBackend());
  const id = await generateIdentity();
  const pre = await generatePreKeys(id.identityKeyPair, 1, 1, ONE_TIME_PREKEY_COUNT);
  await installIdentity(store, id, pre);
  signal = new NucoSignal(store);

  const stored: StoredAccount = {
    handle: randomHandle(),
    displayName,
    identityKeyB64: identityPublicKeyBase64(id),
    registrationId: id.registrationId,
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
      authKeyPair: id.authKeyPair,
    },
    upload: toUploadBundle(pre),
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
    authKeyPair: { publicKey: base64ToBytes(stored.authPub), secretKey: base64ToBytes(stored.authSecret) },
  };
}

// The register frame parameters for this account (used on the relay handshake).
export function registerParamsFor(account: Account, push: import('@nuco/protocol').PushRegistration) {
  return {
    identityKey: account.identityKeyB64,
    authKey: bytesToBase64(account.authKeyPair.publicKey),
    registrationId: account.registrationId,
    deviceId: 1,
    push,
  };
}

export async function setDisplayName(displayName: string): Promise<void> {
  const stored = await getMetaJson<StoredAccount>('account');
  if (!stored) return;
  await setMetaJson('account', { ...stored, displayName });
}
