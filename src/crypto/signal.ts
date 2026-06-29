// The narrow boundary around the unaudited Signal library. Everything Signal specific
// (X3DH session setup, the Double Ratchet cipher, the fingerprint generator) lives behind
// this file, so swapping the v1 library for audited native libsignal later is a localized
// change.
//
// SECURITY: the underlying library (@privacyresearch/libsignal-protocol-typescript) is
// UNAUDITED and must be replaced or audited before production. See provider.ts.

import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type DeviceType,
} from '@privacyresearch/libsignal-protocol-typescript';
import {
  pad,
  unpad,
  type PreKeyBundle,
  type CipherMessageType,
} from '@nuco/protocol';

import { installCryptoProvider } from './provider';
import { NucoSignalStore } from './store';
import {
  abToBase64,
  base64ToAb,
  base64ToBytes,
  binaryStringToBytes,
  bytesToBase64,
  toArrayBuffer,
  u8,
} from './bytes';
import { computeSafetyNumber, formatSafetyNumber } from './safety-number';
import { computeEmojiSas, type SasEmoji } from './sas';

const DEVICE_ID = 1;
const PREKEY_MESSAGE_TYPE = 3;

export interface SealedMessage {
  ciphertext: string; // base64
  messageType: CipherMessageType;
}

export interface VerificationStrings {
  safetyNumber: string;
  safetyNumberRows: string[];
  emoji: SasEmoji[];
}

export class NucoSignal {
  constructor(private readonly store: NucoSignalStore) {
    installCryptoProvider();
  }

  private address(handle: string): SignalProtocolAddress {
    return new SignalProtocolAddress(handle, DEVICE_ID);
  }

  async hasSession(handle: string): Promise<boolean> {
    return new SessionCipher(this.store, this.address(handle)).hasOpenSession();
  }

  // X3DH: establish a session toward a peer from their fetched prekey bundle.
  async startSession(handle: string, bundle: PreKeyBundle): Promise<void> {
    const device: DeviceType = {
      identityKey: base64ToAb(bundle.identityKey),
      registrationId: bundle.registrationId,
      signedPreKey: {
        keyId: bundle.signedPreKey.keyId,
        publicKey: base64ToAb(bundle.signedPreKey.publicKey),
        signature: base64ToAb(bundle.signedPreKey.signature),
      },
      ...(bundle.oneTimePreKey
        ? { preKey: { keyId: bundle.oneTimePreKey.keyId, publicKey: base64ToAb(bundle.oneTimePreKey.publicKey) } }
        : {}),
    };
    await new SessionBuilder(this.store, this.address(handle)).processPreKey(device);
  }

  // Double Ratchet encrypt over the padded plaintext.
  async encrypt(handle: string, plaintext: Uint8Array): Promise<SealedMessage> {
    const padded = pad(plaintext);
    const cipher = new SessionCipher(this.store, this.address(handle));
    const message = await cipher.encrypt(toArrayBuffer(padded));
    const bodyBytes = message.body ? binaryStringToBytes(message.body) : new Uint8Array(0);
    return {
      ciphertext: bytesToBase64(bodyBytes),
      messageType: message.type === PREKEY_MESSAGE_TYPE ? 'prekey' : 'whisper',
    };
  }

  // Double Ratchet decrypt, then remove the fixed size padding.
  async decrypt(handle: string, sealed: SealedMessage): Promise<Uint8Array> {
    const cipher = new SessionCipher(this.store, this.address(handle));
    const ab = base64ToAb(sealed.ciphertext);
    const plaintext =
      sealed.messageType === 'prekey'
        ? await cipher.decryptPreKeyWhisperMessage(ab)
        : await cipher.decryptWhisperMessage(ab);
    return unpad(u8(plaintext));
  }

  async getIdentityPublicKeyBase64(): Promise<string> {
    const pair = await this.store.getIdentityKeyPair();
    if (!pair) throw new Error('no local identity key pair');
    return abToBase64(pair.pubKey);
  }

  // Derive the safety number and emoji SAS that both people compare in person.
  async verificationStrings(
    localHandle: string,
    remoteHandle: string,
    remoteIdentityKeyB64: string,
  ): Promise<VerificationStrings> {
    const localKeyB64 = await this.getIdentityPublicKeyBase64();
    const safetyNumber = await computeSafetyNumber(localHandle, localKeyB64, remoteHandle, remoteIdentityKeyB64);
    return {
      safetyNumber,
      safetyNumberRows: formatSafetyNumber(safetyNumber),
      emoji: computeEmojiSas(localKeyB64, remoteIdentityKeyB64),
    };
  }
}
