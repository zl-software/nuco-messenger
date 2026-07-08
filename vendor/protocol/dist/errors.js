// Stable machine error codes. The relay never sends human readable text. The app
// maps each code to a localized string (see the app i18n error namespace).
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["ProtocolVersionMismatch"] = "PROTOCOL_VERSION_MISMATCH";
    ErrorCode["MalformedMessage"] = "MALFORMED_MESSAGE";
    ErrorCode["Unauthenticated"] = "UNAUTHENTICATED";
    ErrorCode["AuthFailed"] = "AUTH_FAILED";
    ErrorCode["NotRegistered"] = "NOT_REGISTERED";
    ErrorCode["NoSuchHandle"] = "NO_SUCH_HANDLE";
    ErrorCode["RateLimited"] = "RATE_LIMITED";
    ErrorCode["AttestationRequired"] = "ATTESTATION_REQUIRED";
    ErrorCode["AttestationFailed"] = "ATTESTATION_FAILED";
    ErrorCode["QueueFull"] = "QUEUE_FULL";
    ErrorCode["MessageTooLarge"] = "MESSAGE_TOO_LARGE";
    ErrorCode["CallsUnavailable"] = "CALLS_UNAVAILABLE";
    ErrorCode["Internal"] = "INTERNAL";
})(ErrorCode || (ErrorCode = {}));
export const ALL_ERROR_CODES = Object.values(ErrorCode);
//# sourceMappingURL=errors.js.map