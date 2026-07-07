export interface ProtocolVersion {
    readonly major: number;
    readonly minor: number;
}
export declare const PROTOCOL_VERSION: ProtocolVersion;
export declare const PROTOCOL_VERSION_STRING: string;
export declare function isMajorCompatible(remote: ProtocolVersion): boolean;
//# sourceMappingURL=version.d.ts.map