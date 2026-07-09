// Mutual verification primitives, shared by the app and the Node e2e harness. Node pure:
// no react-native, expo, or db imports (the harness and the crypto selftest run this).

import { sha256 } from '@noble/hashes/sha2.js';

import { base64ToBytes, bytesToBase64, compareBytes, utf8Encode } from './bytes';

// The immutable core of a contact card, the fields the cardHash commits to.
export interface CardCore {
  handle: string;
  identityKey: string; // base64
  signedPreKey: { publicKey: string }; // base64
  kyberPreKey: { publicKey: string }; // base64 (since protocol 3.0)
}

// Proof of possession of the peer's QR card. Immutable fields only: displayName may
// change, and since the signed prekeys distribute only via the card and an initiator's
// own prekeys never appear in the PQXDH handshake, only someone who held the card can
// compute this. Layout matches PROTOCOL.md: utf8(handle) 0x00 ik 0x00 spk 0x00 kyber
// (cardHash v2; the pre 3.0 hash omitted the kyber term).
export function computeCardHash(card: CardCore): string {
  const handle = utf8Encode(card.handle);
  const ik = base64ToBytes(card.identityKey);
  const spk = base64ToBytes(card.signedPreKey.publicKey);
  const kyber = base64ToBytes(card.kyberPreKey.publicKey);
  const buf = new Uint8Array(handle.length + 1 + ik.length + 1 + spk.length + 1 + kyber.length);
  let offset = 0;
  buf.set(handle, offset);
  offset += handle.length;
  buf[offset++] = 0;
  buf.set(ik, offset);
  offset += ik.length;
  buf[offset++] = 0;
  buf.set(spk, offset);
  offset += spk.length;
  buf[offset++] = 0;
  buf.set(kyber, offset);
  return bytesToBase64(sha256(buf));
}

// Exactly one side of a pair runs X3DH: the byte smaller identity key initiates, the
// other waits for the initiator's first prekey message. Eliminates session glare, which
// would otherwise be the common case with mutual scanning.
export function isSessionInitiator(localIdentityKeyB64: string, remoteIdentityKeyB64: string): boolean {
  return compareBytes(base64ToBytes(localIdentityKeyB64), base64ToBytes(remoteIdentityKeyB64)) < 0;
}
