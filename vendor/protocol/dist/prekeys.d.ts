export interface SignedPreKeyPublic {
    readonly keyId: number;
    readonly publicKey: string;
    readonly signature: string;
}
export interface OneTimePreKeyPublic {
    readonly keyId: number;
    readonly publicKey: string;
}
export interface PreKeyUpload {
    readonly signedPreKey: SignedPreKeyPublic;
    readonly oneTimePreKeys: readonly OneTimePreKeyPublic[];
}
export interface PreKeyBundle {
    readonly handle: string;
    readonly deviceId: number;
    readonly registrationId: number;
    readonly identityKey: string;
    readonly signedPreKey: SignedPreKeyPublic;
    readonly oneTimePreKey?: OneTimePreKeyPublic;
}
//# sourceMappingURL=prekeys.d.ts.map