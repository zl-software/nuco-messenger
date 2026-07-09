// The narrow boundary around libsignal. Everything Signal specific (PQXDH session setup,
// the Double Ratchet cipher, the fingerprint generator) lives behind this file. The
// actual cipher is official libsignal, injected as a LibsignalBackend (the Expo native
// module on a device, @signalapp/libsignal-client on Node), and every operation is
// record passing: this class loads the records, runs the backend, decides trust, and
// persists the results. Nothing outside this file touches Signal records or trust.

import { pad, unpad, type CipherMessageType } from '@nuco/protocol';

import type { LibsignalBackend, LocalPartyB64 } from './backend';
import { base64ToBytes, bytesToBase64 } from './bytes';
import { KYBER_PREKEY_ID, SIGNED_PREKEY_ID } from './identity';
import { formatSafetyNumber } from './safety-number';
import { computeEmojiSas, type SasEmoji } from './sas';
import type { NucoSignalStore } from './store';

const DEVICE_ID = 1;
const FINGERPRINT_ITERATIONS = 5200;
const FINGERPRINT_VERSION = 2;

export interface SealedMessage {
  ciphertext: string; // base64
  messageType: CipherMessageType;
}

// Everything PQXDH needs about the peer, straight from their scanned contact card.
export interface SessionBootstrap {
  identityKey: string; // base64
  registrationId: number;
  signedPreKey: { keyId: number; publicKey: string; signature: string };
  kyberPreKey: { keyId: number; publicKey: string; signature: string };
}

export interface VerificationStrings {
  safetyNumber: string;
  safetyNumberRows: string[];
  emoji: SasEmoji[];
}

// A received prekey message carries an identity key that differs from the one pinned for
// that handle: the peer re-onboarded (or someone is impersonating them). The decrypt
// discards every record before throwing, so the ratchet and the pin stay untouched; the
// caller resets verification and surfaces the change.
export class IdentityChangedError extends Error {
  constructor(
    readonly handle: string,
    readonly newIdentityKeyB64: string,
  ) {
    super('peer identity key changed');
    this.name = 'IdentityChangedError';
  }
}

export class NucoSignal {
  // Serializes all session mutating work per handle: record passing is read-modify-write
  // on the session record, so two concurrent operations on the same peer would fork the
  // ratchet (the retired JS port had an internal session lock doing the same job).
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: NucoSignalStore,
    private readonly backend: LibsignalBackend,
  ) {}

  private locked<T>(handle: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(handle) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.chains.set(handle, next.catch(() => undefined));
    return next;
  }

  private async localParty(): Promise<LocalPartyB64> {
    const pair = await this.store.getIdentityKeyPair();
    const registrationId = await this.store.getLocalRegistrationId();
    const handle = await this.store.getLocalHandle();
    if (!pair || registrationId === null || handle === null) {
      throw new Error('no local identity provisioned');
    }
    return {
      identityPublic: pair.publicKey,
      identityPrivate: pair.privateKey,
      registrationId,
      handle,
      deviceId: DEVICE_ID,
    };
  }

  async hasSession(handle: string): Promise<boolean> {
    return (await this.store.loadSession(handle)) !== null;
  }

  // Forget everything tied to a peer: the session ratchet and the pinned identity. Called
  // when a contact is deleted (or its identity provably changed) so a future re-add
  // starts from a clean PQXDH exactly like a first scan. A stale responder session would
  // otherwise seal the next verify/confirm with a ratchet the re-adding initiator no
  // longer holds, leaving that confirm undecryptable forever.
  async deleteSession(handle: string): Promise<void> {
    await this.locked(handle, async () => {
      await this.store.removeSession(handle);
      await this.store.removeIdentity(handle);
    });
  }

  // PQXDH: establish a session toward a peer from their scanned contact card. libsignal
  // validates both prekey signatures against the card's identity key, so a forged card
  // fails here. The scan re-anchors trust by physical presence, so the identity pin is
  // overwritten unconditionally. No one time prekeys exist since protocol 2.0.
  async startSession(handle: string, bundle: SessionBootstrap): Promise<void> {
    await this.locked(handle, async () => {
      const local = await this.localParty();
      const existing = await this.store.loadSession(handle);
      const { sessionRecord } = await this.backend.processPreKeyBundle(
        local,
        handle,
        DEVICE_ID,
        {
          registrationId: bundle.registrationId,
          identityKey: bundle.identityKey,
          signedPreKeyId: bundle.signedPreKey.keyId,
          signedPreKey: bundle.signedPreKey.publicKey,
          signedPreKeySignature: bundle.signedPreKey.signature,
          kyberPreKeyId: bundle.kyberPreKey.keyId,
          kyberPreKey: bundle.kyberPreKey.publicKey,
          kyberPreKeySignature: bundle.kyberPreKey.signature,
        },
        existing,
      );
      await this.store.storeSession(handle, sessionRecord);
      await this.store.pinIdentity(handle, bundle.identityKey);
    });
  }

  // Double Ratchet encrypt over the padded plaintext.
  async encrypt(handle: string, plaintext: Uint8Array): Promise<SealedMessage> {
    return this.locked(handle, async () => {
      const local = await this.localParty();
      const session = await this.store.loadSession(handle);
      if (session === null) throw new Error('no session for peer');
      const result = await this.backend.encrypt(
        local,
        handle,
        DEVICE_ID,
        session,
        bytesToBase64(pad(plaintext)),
      );
      await this.store.storeSession(handle, result.sessionRecord);
      return { ciphertext: result.ciphertext, messageType: result.messageType };
    });
  }

  // Double Ratchet decrypt, then remove the fixed size padding. On the prekey path the
  // message's sender identity is compared against the pinned identity BEFORE anything is
  // persisted: on mismatch every returned record is discarded and IdentityChangedError
  // thrown, so a key change can never silently advance the ratchet. A whisper can only
  // ride a session that was established under the pinned identity, so it needs no check.
  async decrypt(handle: string, sealed: SealedMessage): Promise<Uint8Array> {
    return this.locked(handle, async () => {
      const local = await this.localParty();
      if (sealed.messageType === 'prekey') {
        const pinned = await this.store.getPinnedIdentity(handle);
        const existing = await this.store.loadSession(handle);
        const signedPreKeyRecord = await this.store.loadSignedPreKey(SIGNED_PREKEY_ID);
        const kyberPreKeyRecord = await this.store.loadKyberPreKey(KYBER_PREKEY_ID);
        if (signedPreKeyRecord === null || kyberPreKeyRecord === null) {
          throw new Error('no local prekey records');
        }
        const result = await this.backend.decryptPreKey(
          local,
          handle,
          DEVICE_ID,
          existing,
          { [String(SIGNED_PREKEY_ID)]: signedPreKeyRecord },
          { [String(KYBER_PREKEY_ID)]: kyberPreKeyRecord },
          sealed.ciphertext,
        );
        if (pinned !== null && result.remoteIdentityKey !== pinned) {
          throw new IdentityChangedError(handle, result.remoteIdentityKey);
        }
        await this.store.storeSession(handle, result.sessionRecord);
        if (pinned === null) {
          await this.store.pinIdentity(handle, result.remoteIdentityKey);
        }
        return unpad(base64ToBytes(result.plaintext));
      }
      const session = await this.store.loadSession(handle);
      if (session === null) throw new Error('no session for whisper message');
      const result = await this.backend.decryptWhisper(local, handle, DEVICE_ID, session, sealed.ciphertext);
      await this.store.storeSession(handle, result.sessionRecord);
      return unpad(base64ToBytes(result.plaintext));
    });
  }

  async getIdentityPublicKeyBase64(): Promise<string> {
    const pair = await this.store.getIdentityKeyPair();
    if (!pair) throw new Error('no local identity key pair');
    return pair.publicKey;
  }

  // Derive the safety number and emoji SAS that both people compare in person.
  async verificationStrings(
    localHandle: string,
    remoteHandle: string,
    remoteIdentityKeyB64: string,
  ): Promise<VerificationStrings> {
    const localKeyB64 = await this.getIdentityPublicKeyBase64();
    const safetyNumber = await this.backend.fingerprint(
      FINGERPRINT_ITERATIONS,
      FINGERPRINT_VERSION,
      localHandle,
      localKeyB64,
      remoteHandle,
      remoteIdentityKeyB64,
    );
    return {
      safetyNumber,
      safetyNumberRows: formatSafetyNumber(safetyNumber),
      emoji: computeEmojiSas(localKeyB64, remoteIdentityKeyB64),
    };
  }
}
