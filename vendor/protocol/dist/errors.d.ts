export declare enum ErrorCode {
    ProtocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH",
    MalformedMessage = "MALFORMED_MESSAGE",
    Unauthenticated = "UNAUTHENTICATED",
    AuthFailed = "AUTH_FAILED",
    NotRegistered = "NOT_REGISTERED",
    NoSuchHandle = "NO_SUCH_HANDLE",
    RateLimited = "RATE_LIMITED",
    AttestationRequired = "ATTESTATION_REQUIRED",
    AttestationFailed = "ATTESTATION_FAILED",
    QueueFull = "QUEUE_FULL",
    MessageTooLarge = "MESSAGE_TOO_LARGE",
    CallsUnavailable = "CALLS_UNAVAILABLE",
    Banned = "BANNED",
    ReportRejected = "REPORT_REJECTED",
    Internal = "INTERNAL"
}
export type ErrorCodeValue = `${ErrorCode}`;
export declare const ALL_ERROR_CODES: readonly ErrorCodeValue[];
//# sourceMappingURL=errors.d.ts.map