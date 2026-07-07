// The payload encoded in a contact QR code. Public data only, never a private key.
// One person scans the other's card in person, which anchors the other's identity
// key by physical presence. The relay is not involved in producing or reading this.
export const CONTACT_CARD_VERSION = 1;
// A loose runtime check used when decoding a scanned QR before trusting it.
export function isContactCard(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const c = v;
    return (typeof c.v === 'number' &&
        typeof c.handle === 'string' &&
        typeof c.identityKey === 'string' &&
        typeof c.fingerprint === 'string' &&
        typeof c.displayName === 'string');
}
//# sourceMappingURL=qr.js.map