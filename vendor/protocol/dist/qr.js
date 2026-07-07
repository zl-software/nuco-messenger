// The payload encoded in a contact QR code. Public data only, never a private key.
// One person scans the other's card in person, which anchors the other's identity
// key by physical presence. Since v2 the card also carries the signed prekey, so the
// scanner can run X3DH entirely offline; the relay is not involved in producing,
// reading, or acting on this.
export const CONTACT_CARD_VERSION = 2;
// A loose runtime check used when decoding a scanned QR before trusting it.
export function isContactCard(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const c = v;
    return (typeof c.v === 'number' &&
        typeof c.handle === 'string' &&
        typeof c.identityKey === 'string' &&
        typeof c.registrationId === 'number' &&
        Number.isInteger(c.registrationId) &&
        c.registrationId >= 0 &&
        isCardSignedPreKey(c.signedPreKey) &&
        typeof c.fingerprint === 'string' &&
        typeof c.displayName === 'string');
}
function isCardSignedPreKey(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const k = v;
    return (typeof k.keyId === 'number' &&
        Number.isInteger(k.keyId) &&
        k.keyId >= 0 &&
        typeof k.publicKey === 'string' &&
        k.publicKey.length > 0 &&
        typeof k.signature === 'string' &&
        k.signature.length > 0);
}
//# sourceMappingURL=qr.js.map