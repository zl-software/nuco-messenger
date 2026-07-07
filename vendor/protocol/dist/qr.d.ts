import type { SignedPreKeyPublic } from './prekeys.js';
export declare const CONTACT_CARD_VERSION = 3;
export interface ContactCard {
    readonly v: number;
    readonly handle: string;
    readonly identityKey: string;
    readonly registrationId: number;
    readonly signedPreKey: SignedPreKeyPublic;
    readonly fingerprint: string;
    readonly displayName: string;
    readonly server?: string;
}
export declare function isContactCard(v: unknown): v is ContactCard;
//# sourceMappingURL=qr.d.ts.map