// The Node implementation of the libsignal backend, over @signalapp/libsignal-client
// (the official Node binding, same Rust core as the device builds). Used ONLY by the
// crypto selftest and the relay e2e harness; the app never imports this file. Store
// callbacks are Map backed and seeded per call from the records passed in, mirroring
// the record passing contract of the native module. isTrustedIdentity always says yes:
// the trust decision is made by signal.ts against its pinned identity.

import * as ls from '@signalapp/libsignal-client';

import type {
  BackendDecryptResult,
  BackendEncryptResult,
  GeneratedPreKey,
  KeyPairB64,
  LibsignalBackend,
  LocalPartyB64,
  RemoteBundleB64,
} from './backend';
import { base64ToBytes, bytesToBase64, utf8Encode } from './bytes';

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(value) as Uint8Array<ArrayBuffer>;
}

function b64(value: Uint8Array): string {
  return bytesToBase64(value);
}

function addressKey(address: ls.ProtocolAddress): string {
  return `${address.name()}.${address.deviceId()}`;
}

class MapSessionStore extends ls.SessionStore {
  readonly sessions = new Map<string, ls.SessionRecord>();
  async saveSession(name: ls.ProtocolAddress, record: ls.SessionRecord): Promise<void> {
    this.sessions.set(addressKey(name), record);
  }
  async getSession(name: ls.ProtocolAddress): Promise<ls.SessionRecord | null> {
    return this.sessions.get(addressKey(name)) ?? null;
  }
  async getExistingSessions(addresses: ls.ProtocolAddress[]): Promise<ls.SessionRecord[]> {
    const found: ls.SessionRecord[] = [];
    for (const address of addresses) {
      const record = this.sessions.get(addressKey(address));
      if (record) found.push(record);
    }
    return found;
  }
}

class MapIdentityStore extends ls.IdentityKeyStore {
  readonly identities = new Map<string, ls.PublicKey>();
  constructor(
    private readonly pair: ls.IdentityKeyPair,
    private readonly registrationId: number,
  ) {
    super();
  }
  async getIdentityKey(): Promise<ls.PrivateKey> {
    return this.pair.privateKey;
  }
  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId;
  }
  async saveIdentity(name: ls.ProtocolAddress, key: ls.PublicKey): Promise<ls.IdentityChange> {
    const previous = this.identities.get(addressKey(name));
    this.identities.set(addressKey(name), key);
    const replaced = previous !== undefined && b64(previous.serialize()) !== b64(key.serialize());
    return replaced ? ls.IdentityChange.ReplacedExisting : ls.IdentityChange.NewOrUnchanged;
  }
  async isTrustedIdentity(): Promise<boolean> {
    return true; // trust policy lives in signal.ts, against the pinned identity
  }
  async getIdentity(name: ls.ProtocolAddress): Promise<ls.PublicKey | null> {
    return this.identities.get(addressKey(name)) ?? null;
  }
}

class MapPreKeyStore extends ls.PreKeyStore {
  // The protocol has no one time prekeys since 2.0; a message referencing one fails.
  async savePreKey(): Promise<void> {}
  async getPreKey(): Promise<ls.PreKeyRecord> {
    throw new Error('no one time prekeys exist');
  }
  async removePreKey(): Promise<void> {}
}

class MapSignedPreKeyStore extends ls.SignedPreKeyStore {
  readonly records = new Map<number, ls.SignedPreKeyRecord>();
  async saveSignedPreKey(id: number, record: ls.SignedPreKeyRecord): Promise<void> {
    this.records.set(id, record);
  }
  async getSignedPreKey(id: number): Promise<ls.SignedPreKeyRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`no signed prekey ${id}`);
    return record;
  }
}

class MapKyberPreKeyStore extends ls.KyberPreKeyStore {
  readonly records = new Map<number, ls.KyberPreKeyRecord>();
  async saveKyberPreKey(id: number, record: ls.KyberPreKeyRecord): Promise<void> {
    this.records.set(id, record);
  }
  async getKyberPreKey(id: number): Promise<ls.KyberPreKeyRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error(`no kyber prekey ${id}`);
    return record;
  }
  async markKyberPreKeyUsed(): Promise<void> {
    // The one Kyber prekey is reusable for the account lifetime (last resort semantics).
  }
}

interface SeededStores {
  session: MapSessionStore;
  identity: MapIdentityStore;
  remoteAddress: ls.ProtocolAddress;
  localAddress: ls.ProtocolAddress;
}

function seedStores(
  local: LocalPartyB64,
  remoteHandle: string,
  remoteDeviceId: number,
  existingSessionRecord: string | null,
): SeededStores {
  const pair = new ls.IdentityKeyPair(
    ls.PublicKey.deserialize(fromB64(local.identityPublic)),
    ls.PrivateKey.deserialize(fromB64(local.identityPrivate)),
  );
  const session = new MapSessionStore();
  const identity = new MapIdentityStore(pair, local.registrationId);
  const remoteAddress = ls.ProtocolAddress.new(remoteHandle, remoteDeviceId);
  const localAddress = ls.ProtocolAddress.new(local.handle, local.deviceId);
  if (existingSessionRecord !== null) {
    session.sessions.set(addressKey(remoteAddress), ls.SessionRecord.deserialize(fromB64(existingSessionRecord)));
  }
  return { session, identity, remoteAddress, localAddress };
}

function sessionOut(stores: SeededStores): string {
  const record = stores.session.sessions.get(addressKey(stores.remoteAddress));
  if (!record) throw new Error('libsignal left no session record');
  return b64(record.serialize());
}

export class NodeLibsignalBackend implements LibsignalBackend {
  async generateIdentityKeyPair(): Promise<KeyPairB64> {
    const pair = ls.IdentityKeyPair.generate();
    return {
      publicKey: b64(pair.publicKey.serialize()),
      privateKey: b64(pair.privateKey.serialize()),
    };
  }

  async generateSignedPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey> {
    const identityKey = ls.PrivateKey.deserialize(fromB64(identityPrivate));
    const prekey = ls.PrivateKey.generate();
    const publicKey = prekey.getPublicKey();
    const signature = identityKey.sign(publicKey.serialize());
    const record = ls.SignedPreKeyRecord.new(keyId, Date.now(), publicKey, prekey, signature);
    return {
      record: b64(record.serialize()),
      publicKey: b64(publicKey.serialize()),
      signature: b64(signature),
    };
  }

  async generateKyberPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey> {
    const identityKey = ls.PrivateKey.deserialize(fromB64(identityPrivate));
    const kemPair = ls.KEMKeyPair.generate();
    const publicKey = kemPair.getPublicKey();
    const signature = identityKey.sign(publicKey.serialize());
    const record = ls.KyberPreKeyRecord.new(keyId, Date.now(), kemPair, signature);
    return {
      record: b64(record.serialize()),
      publicKey: b64(publicKey.serialize()),
      signature: b64(signature),
    };
  }

  async processPreKeyBundle(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    bundle: RemoteBundleB64,
    existingSessionRecord: string | null,
  ): Promise<{ sessionRecord: string }> {
    const stores = seedStores(local, remoteHandle, remoteDeviceId, existingSessionRecord);
    const preKeyBundle = ls.PreKeyBundle.new(
      bundle.registrationId,
      remoteDeviceId,
      null,
      null,
      bundle.signedPreKeyId,
      ls.PublicKey.deserialize(fromB64(bundle.signedPreKey)),
      fromB64(bundle.signedPreKeySignature),
      ls.PublicKey.deserialize(fromB64(bundle.identityKey)),
      bundle.kyberPreKeyId,
      ls.KEMPublicKey.deserialize(fromB64(bundle.kyberPreKey)),
      fromB64(bundle.kyberPreKeySignature),
    );
    await ls.processPreKeyBundle(
      preKeyBundle,
      stores.remoteAddress,
      stores.localAddress,
      stores.session,
      stores.identity,
    );
    return { sessionRecord: sessionOut(stores) };
  }

  async encrypt(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    plaintext: string,
  ): Promise<BackendEncryptResult> {
    const stores = seedStores(local, remoteHandle, remoteDeviceId, sessionRecord);
    const message = await ls.signalEncrypt(
      fromB64(plaintext),
      stores.remoteAddress,
      stores.localAddress,
      stores.session,
      stores.identity,
    );
    let messageType: 'prekey' | 'whisper';
    if (message.type() === ls.CiphertextMessageType.PreKey) messageType = 'prekey';
    else if (message.type() === ls.CiphertextMessageType.Whisper) messageType = 'whisper';
    else throw new Error(`unexpected ciphertext type ${message.type()}`);
    return {
      ciphertext: b64(message.serialize()),
      messageType,
      sessionRecord: sessionOut(stores),
    };
  }

  async decryptWhisper(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    ciphertext: string,
  ): Promise<BackendDecryptResult> {
    const stores = seedStores(local, remoteHandle, remoteDeviceId, sessionRecord);
    const message = ls.SignalMessage.deserialize(fromB64(ciphertext));
    const plaintext = await ls.signalDecrypt(
      message,
      stores.remoteAddress,
      stores.localAddress,
      stores.session,
      stores.identity,
    );
    return { plaintext: b64(plaintext), sessionRecord: sessionOut(stores) };
  }

  async decryptPreKey(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    existingSessionRecord: string | null,
    signedPreKeyRecords: Record<string, string>,
    kyberPreKeyRecords: Record<string, string>,
    ciphertext: string,
  ): Promise<Required<BackendDecryptResult>> {
    const stores = seedStores(local, remoteHandle, remoteDeviceId, existingSessionRecord);
    const signedStore = new MapSignedPreKeyStore();
    for (const [id, record] of Object.entries(signedPreKeyRecords)) {
      signedStore.records.set(Number(id), ls.SignedPreKeyRecord.deserialize(fromB64(record)));
    }
    const kyberStore = new MapKyberPreKeyStore();
    for (const [id, record] of Object.entries(kyberPreKeyRecords)) {
      kyberStore.records.set(Number(id), ls.KyberPreKeyRecord.deserialize(fromB64(record)));
    }
    const message = ls.PreKeySignalMessage.deserialize(fromB64(ciphertext));
    const plaintext = await ls.signalDecryptPreKey(
      message,
      stores.remoteAddress,
      stores.localAddress,
      stores.session,
      stores.identity,
      new MapPreKeyStore(),
      signedStore,
      kyberStore,
    );
    const remoteIdentityKey = await stores.identity.getIdentity(stores.remoteAddress);
    if (!remoteIdentityKey) throw new Error('prekey decrypt recorded no sender identity');
    return {
      plaintext: b64(plaintext),
      sessionRecord: sessionOut(stores),
      remoteIdentityKey: b64(remoteIdentityKey.serialize()),
    };
  }

  async fingerprint(
    iterations: number,
    version: number,
    localIdentifier: string,
    localIdentityKey: string,
    remoteIdentifier: string,
    remoteIdentityKey: string,
  ): Promise<string> {
    const fingerprint = ls.Fingerprint.new(
      iterations,
      version,
      utf8Encode(localIdentifier) as Uint8Array<ArrayBuffer>,
      ls.PublicKey.deserialize(fromB64(localIdentityKey)),
      utf8Encode(remoteIdentifier) as Uint8Array<ArrayBuffer>,
      ls.PublicKey.deserialize(fromB64(remoteIdentityKey)),
    );
    return fingerprint.displayableFingerprint().toString();
  }
}
