// Typed entry for the NucoLibsignal native module. The ONLY importer is
// src/crypto/backend-native.ts; everything else goes through the crypto facade.
// All binary values are base64 strings. See ios/NucoLibsignalModule.swift for the
// record passing contract.

export interface KeyPairB64 {
  publicKey: string;
  privateKey: string;
}

export interface GeneratedPreKey {
  record: string;
  publicKey: string;
  signature: string;
}

export interface LocalPartyParams {
  identityPublic: string;
  identityPrivate: string;
  registrationId: number;
  handle: string;
  deviceId: number;
}

export interface RemoteBundleParams {
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKey: string;
  kyberPreKeySignature: string;
}

export interface NativeEncryptResult {
  ciphertext: string;
  messageType: 'prekey' | 'whisper';
  sessionRecord: string;
}

export interface NativeDecryptResult {
  plaintext: string;
  sessionRecord: string;
  remoteIdentityKey?: string;
}

export interface NucoLibsignalNative {
  generateIdentityKeyPair(): Promise<KeyPairB64>;
  generateSignedPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey>;
  generateKyberPreKey(identityPrivate: string, keyId: number): Promise<GeneratedPreKey>;
  processPreKeyBundle(
    local: LocalPartyParams,
    remoteHandle: string,
    remoteDeviceId: number,
    bundle: RemoteBundleParams,
    existingSessionRecord: string | null,
  ): Promise<{ sessionRecord: string }>;
  encrypt(
    local: LocalPartyParams,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    plaintext: string,
  ): Promise<NativeEncryptResult>;
  decryptWhisper(
    local: LocalPartyParams,
    remoteHandle: string,
    remoteDeviceId: number,
    sessionRecord: string,
    ciphertext: string,
  ): Promise<NativeDecryptResult>;
  decryptPreKey(
    local: LocalPartyParams,
    remoteHandle: string,
    remoteDeviceId: number,
    existingSessionRecord: string | null,
    signedPreKeyRecords: Record<string, string>,
    kyberPreKeyRecords: Record<string, string>,
    ciphertext: string,
  ): Promise<Required<NativeDecryptResult>>;
  fingerprint(
    iterations: number,
    version: number,
    localIdentifier: string,
    localIdentityKey: string,
    remoteIdentifier: string,
    remoteIdentityKey: string,
  ): Promise<string>;
}

// Lazy so importing this file never crashes a runtime without the native module (Node
// harnesses use the @signalapp/libsignal-client backend instead and never call this).
export function getNativeLibsignal(): NucoLibsignalNative {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireNativeModule } = require('expo-modules-core') as {
    requireNativeModule: (name: string) => NucoLibsignalNative;
  };
  return requireNativeModule('NucoLibsignal');
}
