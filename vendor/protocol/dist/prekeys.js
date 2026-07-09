// The signed prekeys as they travel inside the QR contact card (see qr.ts). Public data
// only: no private key ever appears in the protocol or reaches the relay. Since 2.0 the
// relay stores and serves no prekeys at all; the card is the only distribution channel,
// so possessing a peer's signed prekey proves their QR code was scanned. Since 3.0 the
// card also carries one signed Kyber prekey, because the initial key agreement is PQXDH:
// classic elliptic curve agreement plus an ML-KEM-1024 encapsulation.
// Exact decoded byte lengths of the binary card fields, shared by the card codec and any
// consumer that wants to sanity check key material before use. libsignal serializes
// public keys with a one byte type prefix: 32 + 1 for the curve keys, 1568 + 1 for
// ML-KEM-1024. XEd25519 signatures are 64 bytes.
export const IDENTITY_KEY_LEN = 33;
export const SIGNED_PREKEY_PUB_LEN = 33;
export const KYBER_PREKEY_PUB_LEN = 1569;
export const PREKEY_SIGNATURE_LEN = 64;
//# sourceMappingURL=prekeys.js.map