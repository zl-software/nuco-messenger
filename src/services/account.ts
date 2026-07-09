// Account provisioning and loading. The identity key pair and both signed prekeys live
// in the encrypted Signal store; the account record (handle, display name, public
// identity key, prekey public parts, transport auth key pair) lives in the encrypted
// meta table. Nothing here is readable until unlock. The prekey public parts are
// persisted so the QR contact card can embed them without touching the Signal store.

import * as Crypto from 'expo-crypto';

import {
  generateIdentity,
  generateSignedPreKey,
  generateKyberPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  toKyberPreKeyPublic,
  identityPublicKeyBase64,
  authPublicKeyBase64,
  NucoSignal,
  NucoSignalStore,
  SIGNED_PREKEY_ID,
  KYBER_PREKEY_ID,
  type AuthKeyPair,
} from '@/crypto';
import { nativeBackend } from '@/crypto/backend-native';
import { bytesToBase64, base64ToBytes } from '@/crypto/bytes';
import type { SignedPreKeyPublic, KyberPreKeyPublic } from '@nuco/protocol';
import { SqliteSignalBackend } from '@/db/signal-backend';
import { getMetaJson, setMetaJson } from '@/db/repos/meta';

export interface Account {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
  signedPreKey: SignedPreKeyPublic;
  kyberPreKey: KyberPreKeyPublic;
  authKeyPair: AuthKeyPair;
}

export interface StoredAccount {
  handle: string;
  displayName: string;
  identityKeyB64: string;
  registrationId: number;
  signedPreKey: SignedPreKeyPublic;
  kyberPreKey?: KyberPreKeyPublic; // absent on a pre 3.0 record until the migration rewrites it
  authPub: string;
  authSecret: string;
}

let signal: NucoSignal | null = null;

export function getSignal(): NucoSignal {
  if (!signal) signal = new NucoSignal(new NucoSignalStore(new SqliteSignalBackend()), nativeBackend());
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
  const backend = nativeBackend();
  const handle = randomHandle();
  const id = await generateIdentity(backend);
  const signedPreKey = await generateSignedPreKey(backend, id.identityKeyPair.privateKey, SIGNED_PREKEY_ID);
  const kyberPreKey = await generateKyberPreKey(backend, id.identityKeyPair.privateKey, KYBER_PREKEY_ID);
  await installIdentity(store, id, signedPreKey, kyberPreKey, handle);
  signal = new NucoSignal(store, backend);

  const stored: StoredAccount = {
    handle,
    displayName,
    identityKeyB64: identityPublicKeyBase64(id),
    registrationId: id.registrationId,
    signedPreKey: toSignedPreKeyPublic(signedPreKey),
    kyberPreKey: toKyberPreKeyPublic(kyberPreKey),
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
      kyberPreKey: stored.kyberPreKey!,
      authKeyPair: id.authKeyPair,
    },
  };
}

export async function loadAccount(): Promise<Account | null> {
  const stored = await getMetaJson<StoredAccount>('account');
  if (!stored) return null;
  if (!stored.kyberPreKey) {
    // A pre 3.0 record; the break clean migration (services/signal-migration.ts, run
    // before anything consumes the account) rewrites it. Reaching this means a caller
    // raced the migration; fail loudly rather than hand out a card without a kyber key.
    throw new Error('account record predates protocol 3.0');
  }
  return {
    handle: stored.handle,
    displayName: stored.displayName,
    identityKeyB64: stored.identityKeyB64,
    registrationId: stored.registrationId,
    signedPreKey: stored.signedPreKey,
    kyberPreKey: stored.kyberPreKey,
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
