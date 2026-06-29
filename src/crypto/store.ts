// The Signal protocol store. It implements the library's StorageType over a small async
// key value backend so the same logic runs over an in memory map (Node and tests) or the
// app's encrypted SQLCipher database (Hermes). Identity and session state are sensitive
// and only ever live inside the encrypted database, never in plaintext storage.

import type { KeyPairType, StorageType, Direction } from '@privacyresearch/libsignal-protocol-typescript';

import { abToBase64, base64ToAb } from './bytes';

// A namespaced async string store. Implementations: InMemoryKvBackend (tests / Node) and
// the op-sqlite backed backend in the app db layer.
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class InMemoryKvBackend implements KvBackend {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

interface SerializedKeyPair {
  pub: string;
  priv: string;
}

function serializeKeyPair(kp: KeyPairType): string {
  const out: SerializedKeyPair = { pub: abToBase64(kp.pubKey), priv: abToBase64(kp.privKey) };
  return JSON.stringify(out);
}
function deserializeKeyPair(s: string): KeyPairType {
  const o = JSON.parse(s) as SerializedKeyPair;
  return { pubKey: base64ToAb(o.pub), privKey: base64ToAb(o.priv) };
}

const K = {
  identityKeyPair: 'idkeypair',
  registrationId: 'regid',
  preKey: (id: string | number) => `prekey:${id}`,
  signedPreKey: (id: string | number) => `signedprekey:${id}`,
  session: (addr: string) => `session:${addr}`,
  identity: (id: string) => `identity:${id}`,
};

export class NucoSignalStore implements StorageType {
  constructor(private readonly kv: KvBackend) {}

  // --- one time provisioning helpers (not part of StorageType) ---

  async setIdentityKeyPair(kp: KeyPairType): Promise<void> {
    await this.kv.set(K.identityKeyPair, serializeKeyPair(kp));
  }
  async setLocalRegistrationId(id: number): Promise<void> {
    await this.kv.set(K.registrationId, String(id));
  }

  // --- StorageType ---

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const s = await this.kv.get(K.identityKeyPair);
    return s ? deserializeKeyPair(s) : undefined;
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    const s = await this.kv.get(K.registrationId);
    return s === null ? undefined : Number(s);
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, _direction: Direction): Promise<boolean> {
    const known = await this.kv.get(K.identity(identifier));
    if (known === null) return true; // trust on first use; verification is enforced above the cipher
    return known === abToBase64(identityKey);
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const identifier = encodedAddress.split('.')[0] ?? encodedAddress;
    const incoming = abToBase64(publicKey);
    const existing = await this.kv.get(K.identity(identifier));
    await this.kv.set(K.identity(identifier), incoming);
    // Returns true when an existing identity was replaced by a different key.
    return existing !== null && existing !== incoming;
  }

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const s = await this.kv.get(K.preKey(keyId));
    return s ? deserializeKeyPair(s) : undefined;
  }
  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.kv.set(K.preKey(keyId), serializeKeyPair(keyPair));
  }
  async removePreKey(keyId: string | number): Promise<void> {
    await this.kv.remove(K.preKey(keyId));
  }

  async storeSession(encodedAddress: string, record: string): Promise<void> {
    await this.kv.set(K.session(encodedAddress), record);
  }
  async loadSession(encodedAddress: string): Promise<string | undefined> {
    const s = await this.kv.get(K.session(encodedAddress));
    return s === null ? undefined : s;
  }

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const s = await this.kv.get(K.signedPreKey(keyId));
    return s ? deserializeKeyPair(s) : undefined;
  }
  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.kv.set(K.signedPreKey(keyId), serializeKeyPair(keyPair));
  }
  async removeSignedPreKey(keyId: string | number): Promise<void> {
    await this.kv.remove(K.signedPreKey(keyId));
  }
}
