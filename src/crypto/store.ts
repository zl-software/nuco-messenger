// The Signal record store: typed accessors over a small async key value backend, so the
// same logic runs over an in memory map (Node and tests) or the app's encrypted SQLCipher
// database (Hermes). Values are libsignal's serialized protobuf records as base64 (store
// format 2; format 1 was the retired JS port's JSON records, detected and wiped by the
// break clean migration). Identity and session state are sensitive and only ever live
// inside the encrypted database, never in plaintext storage.

import type { KeyPairB64 } from './backend';

// A namespaced async string store. Implementations: InMemoryKvBackend (tests / Node) and
// the op-sqlite backed backend in the app db layer.
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  wipeAll(): Promise<void>;
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
  async wipeAll(): Promise<void> {
    this.map.clear();
  }
}

// The marker distinguishing native libsignal records from the retired JS port's JSON
// records: idkeypair present without it means a pre swap store.
export const STORE_FORMAT_NATIVE = '2';

const K = {
  identityKeyPair: 'idkeypair',
  registrationId: 'regid',
  localHandle: 'localhandle',
  storeFormat: 'storefmt',
  signedPreKey: (id: number) => `signedprekey:${id}`,
  kyberPreKey: (id: number) => `kyberprekey:${id}`,
  session: (handle: string) => `session:${handle}.1`,
  identity: (handle: string) => `identity:${handle}`,
};

export class NucoSignalStore {
  constructor(private readonly kv: KvBackend) {}

  // --- provisioning ---

  async setIdentityKeyPair(pair: KeyPairB64): Promise<void> {
    await this.kv.set(K.identityKeyPair, JSON.stringify({ pub: pair.publicKey, priv: pair.privateKey }));
  }
  async getIdentityKeyPair(): Promise<KeyPairB64 | null> {
    const raw = await this.kv.get(K.identityKeyPair);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { pub: string; priv: string };
    return { publicKey: parsed.pub, privateKey: parsed.priv };
  }

  async setLocalRegistrationId(id: number): Promise<void> {
    await this.kv.set(K.registrationId, String(id));
  }
  async getLocalRegistrationId(): Promise<number | null> {
    const raw = await this.kv.get(K.registrationId);
    return raw === null ? null : Number(raw);
  }

  async setLocalHandle(handle: string): Promise<void> {
    await this.kv.set(K.localHandle, handle);
  }
  async getLocalHandle(): Promise<string | null> {
    return this.kv.get(K.localHandle);
  }

  async setStoreFormat(format: string): Promise<void> {
    await this.kv.set(K.storeFormat, format);
  }
  async getStoreFormat(): Promise<string | null> {
    return this.kv.get(K.storeFormat);
  }

  // --- prekey records (exactly one of each exists, see identity.ts) ---

  async storeSignedPreKey(keyId: number, record: string): Promise<void> {
    await this.kv.set(K.signedPreKey(keyId), record);
  }
  async loadSignedPreKey(keyId: number): Promise<string | null> {
    return this.kv.get(K.signedPreKey(keyId));
  }

  async storeKyberPreKey(keyId: number, record: string): Promise<void> {
    await this.kv.set(K.kyberPreKey(keyId), record);
  }
  async loadKyberPreKey(keyId: number): Promise<string | null> {
    return this.kv.get(K.kyberPreKey(keyId));
  }

  // --- sessions ---

  async storeSession(handle: string, record: string): Promise<void> {
    await this.kv.set(K.session(handle), record);
  }
  async loadSession(handle: string): Promise<string | null> {
    return this.kv.get(K.session(handle));
  }
  async removeSession(handle: string): Promise<void> {
    await this.kv.remove(K.session(handle));
  }

  // --- pinned peer identities (the trust anchor the decrypt path compares against) ---

  async pinIdentity(handle: string, identityKeyB64: string): Promise<void> {
    await this.kv.set(K.identity(handle), identityKeyB64);
  }
  async getPinnedIdentity(handle: string): Promise<string | null> {
    return this.kv.get(K.identity(handle));
  }
  async removeIdentity(handle: string): Promise<void> {
    await this.kv.remove(K.identity(handle));
  }

  // --- break clean migration ---

  async wipeAll(): Promise<void> {
    await this.kv.wipeAll();
  }
}
