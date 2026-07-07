import type { ClientMessage } from './messages.js';
import { ErrorCode } from './errors.js';
export declare function isRecord(v: unknown): v is Record<string, unknown>;
export declare const LIMITS: {
    readonly handleMaxLen: 128;
    readonly keyB64MaxLen: 2048;
    readonly signatureB64MaxLen: 2048;
    readonly ciphertextB64MaxLen: 262144;
    readonly oneTimeBatchMax: 200;
    readonly ridMaxLen: 128;
    readonly idMaxLen: 128;
    readonly apnsTopicMaxLen: 256;
    readonly pushTokenMaxLen: 4096;
};
export type ParseResult = {
    ok: true;
    message: ClientMessage;
} | {
    ok: false;
    code: ErrorCode;
};
export declare function parseClientMessage(raw: string): ParseResult;
//# sourceMappingURL=validate.d.ts.map