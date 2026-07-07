export declare const CONTACT_CARD_VERSION = 1;
export interface ContactCard {
    readonly v: number;
    readonly handle: string;
    readonly identityKey: string;
    readonly fingerprint: string;
    readonly displayName: string;
}
export declare function isContactCard(v: unknown): v is ContactCard;
//# sourceMappingURL=qr.d.ts.map