export type MessageContent = {
    readonly t: 'text';
    readonly body: string;
    readonly replyTo?: string;
} | {
    readonly t: 'retention/request';
    readonly value: number;
} | {
    readonly t: 'retention/accept';
    readonly value: number;
} | {
    readonly t: 'retention/cancel';
} | {
    readonly t: 'screenshot/request';
    readonly on: boolean;
} | {
    readonly t: 'screenshot/accept';
    readonly on: boolean;
} | {
    readonly t: 'screenshot/cancel';
} | {
    readonly t: 'call/offer';
    readonly callId: string;
    readonly sdp: string;
} | {
    readonly t: 'call/accept';
    readonly callId: string;
} | {
    readonly t: 'call/answer';
    readonly callId: string;
    readonly sdp: string;
} | {
    readonly t: 'call/end';
    readonly callId: string;
    readonly reason: CallEndReason | (string & {});
} | {
    readonly t: 'verify/confirm';
    readonly cardHash: string;
} | {
    readonly t: 'message/delete';
    readonly id: string;
} | {
    readonly t: 'profile/name';
    readonly name: string;
} | {
    readonly t: 'image';
    readonly mime: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly sha256: string;
    readonly chunks: number;
} | {
    readonly t: 'image/chunk';
    readonly ref: string;
    readonly seq: number;
    readonly data: string;
};
export type MessageContentType = MessageContent['t'];
export declare const MESSAGE_BODY_MAX_LEN = 16384;
export declare const RETENTION_MAX_SECONDS: number;
export declare const MESSAGE_ID_MAX_LEN = 64;
export declare const IMAGE_CHUNK_RAW_BYTES = 48000;
export declare const IMAGE_CHUNK_DATA_B64_MAX = 64000;
export declare const IMAGE_MAX_CHUNKS = 64;
export declare const IMAGE_MAX_BYTES: number;
export declare const IMAGE_SHA256_B64_LEN = 44;
export declare const IMAGE_MAX_DIM = 8192;
export declare const IMAGE_MIME_JPEG = "image/jpeg";
export declare const CALL_ID_MAX_LEN = 64;
export declare const CALL_SDP_MAX_LEN = 8192;
export declare const CALL_END_REASON_MAX_LEN = 32;
export declare const CALL_RING_TIMEOUT_SECONDS = 45;
export declare const CALL_OFFER_STALE_SECONDS = 120;
export declare const CARD_HASH_LEN = 44;
export declare const NAME_MAX_LEN = 64;
export declare const CALL_END_REASONS: readonly ["hangup", "decline", "busy", "timeout", "error"];
export type CallEndReason = (typeof CALL_END_REASONS)[number];
export declare const MESSAGE_CONTENT_TYPES: MessageContentType[];
export declare function encodeContent(content: MessageContent): Uint8Array;
export interface UnknownContent {
    readonly t: 'unknown';
    readonly originalType: string;
}
export type DecodedContent = MessageContent | UnknownContent;
export declare function decodeContent(bytes: Uint8Array): DecodedContent;
export declare function callOfferWins(localCallId: string, remoteCallId: string): boolean;
//# sourceMappingURL=content.d.ts.map