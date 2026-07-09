// The libsignal backend seam. NucoSignal (signal.ts) is written against this interface
// and receives an implementation by constructor injection: the Expo native module on a
// device (backend-native.ts) or @signalapp/libsignal-client on Node (backend-node.ts,
// used by the crypto selftest and the relay e2e harness; same Rust core as the device
// builds). Every call is a pure record passing operation: serialized records go in, the
// result plus updated records come out, and the caller persists. All binary values are
// base64 strings. This file is Node pure: types only, no imports.

export interface KeyPairB64 {
  publicKey: string;
  privateKey: string;
}

// A generated signed prekey (elliptic curve or Kyber): the full serialized record for
// the store, plus the public parts that go onto the QR contact card.
export interface GeneratedPreKey {
  record: string;
  publicKey: string;
  signature: string;
}

// The local side of every session operation: identity key pair, registration id, and
// the address libsignal binds the session to.
export interface LocalPartyB64 {
  identityPublic: string;
  identityPrivate: string;
  registrationId: number;
  handle: string;
  deviceId: number;
}

// The peer's PQXDH bundle, straight from their scanned contact card.
export interface RemoteBundleB64 {
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKey: string;
  kyberPreKeySignature: string;
}

export interface BackendEncryptResult {
  ciphertext: string;
  messageType: 'prekey' | 'whisper';
  sessionRecord: string;
}

export interface BackendDecryptResult {
  plaintext: string;
  sessionRecord: string;
  // Present on the prekey path only: the sender identity carried by the message, which
  // the caller compares against its pinned identity BEFORE persisting anything.
  remoteIdentityKey?: string;
}

export interface LibsignalBackend {
  generateIdentityKeyPair(): Promise<KeyPairB64>;
  generateSignedPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey>;
  generateKyberPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey>;
  processPreKeyBundle(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    bundle: RemoteBundleB64,
    existingSessionRecord: string | null,
  ): Promise<{ sessionRecord: string }>;
  encrypt(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    plaintext: string,
  ): Promise<BackendEncryptResult>;
  decryptWhisper(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    ciphertext: string,
  ): Promise<BackendDecryptResult>;
  decryptPreKey(
    local: LocalPartyB64,
    remoteHandle: string,
    remoteDeviceId: number,
    existingSessionRecord: string | null,
    signedPreKeyRecords: Record<string, string>,
    kyberPreKeyRecords: Record<string, string>,
    ciphertext: string,
  ): Promise<Required<BackendDecryptResult>>;
  fingerprint(
    iterations: number,
    version: number,
    localIdentifier: string,
    localIdentityKey: string,
    remoteIdentifier: string,
    remoteIdentityKey: string,
  ): Promise<string>;
}
