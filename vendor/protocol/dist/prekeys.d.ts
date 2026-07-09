export interface SignedPreKeyPublic {
    readonly keyId: number;
    readonly publicKey: string;
    readonly signature: string;
}
export interface KyberPreKeyPublic {
    readonly keyId: number;
    readonly publicKey: string;
    readonly signature: string;
}
export declare const IDENTITY_KEY_LEN = 33;
export declare const SIGNED_PREKEY_PUB_LEN = 33;
export declare const KYBER_PREKEY_PUB_LEN = 1569;
export declare const PREKEY_SIGNATURE_LEN = 64;
//# sourceMappingURL=prekeys.d.ts.map