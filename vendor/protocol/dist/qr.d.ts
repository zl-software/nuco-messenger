import type { SignedPreKeyPublic, KyberPreKeyPublic } from './prekeys.js';
export declare const CONTACT_CARD_VERSION = 4;
export declare const CARD_HANDLE_MAX_LEN = 128;
export declare const CARD_NAME_MAX_LEN = 64;
export declare const CARD_SERVER_MAX_LEN = 256;
export interface ContactCard {
    readonly v: number;
    readonly handle: string;
    readonly identityKey: string;
    readonly registrationId: number;
    readonly signedPreKey: SignedPreKeyPublic;
    readonly kyberPreKey: KyberPreKeyPublic;
    readonly displayName: string;
    readonly server?: string;
}
export declare function isContactCard(v: unknown): v is ContactCard;
//# sourceMappingURL=qr.d.ts.map