// Hand rolled runtime validators for untrusted input. The relay parses every client
// frame through parseClientMessage before acting on it. Kept dependency free and
// explicit so the trust boundary is easy to audit.
import { ErrorCode } from './errors.js';
export function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStr(v) {
    return typeof v === 'string';
}
function isNonEmptyStr(v) {
    return typeof v === 'string' && v.length > 0;
}
function isInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
}
function isUint(v) {
    return isInt(v) && v >= 0;
}
// Caps that bound abuse independently of the relay config.
export const LIMITS = {
    handleMaxLen: 128,
    keyB64MaxLen: 2048,
    signatureB64MaxLen: 2048,
    ciphertextB64MaxLen: 262144, // generous ceiling above the largest padded bucket
    ridMaxLen: 128,
    idMaxLen: 128,
    apnsTopicMaxLen: 256,
    pushTokenMaxLen: 4096,
};
function isHandle(v) {
    return isNonEmptyStr(v) && v.length <= LIMITS.handleMaxLen;
}
// Standard base64 with padding, exactly what the client's encoder emits (length a multiple
// of 4, only the base64 alphabet, at most two trailing '='). Rejecting malformed base64 at
// the trust boundary stops garbage key material from being stored and later handed to peers.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function isBase64(v) {
    return v.length % 4 === 0 && BASE64_RE.test(v);
}
function isKeyB64(v) {
    return isNonEmptyStr(v) && v.length <= LIMITS.keyB64MaxLen && isBase64(v);
}
const PUSH_KINDS = ['apns', 'unifiedpush', 'none'];
function isPushRegistration(v) {
    if (!isRecord(v))
        return false;
    if (!isStr(v.kind) || !PUSH_KINDS.includes(v.kind))
        return false;
    if (v.token !== undefined && !(isStr(v.token) && v.token.length <= LIMITS.pushTokenMaxLen))
        return false;
    if (v.endpoint !== undefined && !(isStr(v.endpoint) && v.endpoint.length <= LIMITS.pushTokenMaxLen))
        return false;
    if (v.apnsTopic !== undefined && !(isStr(v.apnsTopic) && v.apnsTopic.length <= LIMITS.apnsTopicMaxLen))
        return false;
    return true;
}
const CIPHER_TYPES = ['prekey', 'whisper'];
function isEnvelope(v) {
    return (isRecord(v) &&
        isNonEmptyStr(v.id) &&
        v.id.length <= LIMITS.idMaxLen &&
        isNonEmptyStr(v.ciphertext) &&
        v.ciphertext.length <= LIMITS.ciphertextB64MaxLen &&
        isStr(v.messageType) &&
        CIPHER_TYPES.includes(v.messageType) &&
        isInt(v.sentAt));
}
function isRid(v) {
    return isNonEmptyStr(v) && v.length <= LIMITS.ridMaxLen;
}
const MALFORMED = { ok: false, code: ErrorCode.MalformedMessage };
export function parseClientMessage(raw) {
    let v;
    try {
        v = JSON.parse(raw);
    }
    catch {
        return MALFORMED;
    }
    if (!isRecord(v) || !isStr(v.type))
        return MALFORMED;
    switch (v.type) {
        case 'connect': {
            if (!isRecord(v.protocolVersion))
                return MALFORMED;
            const pv = v.protocolVersion;
            if (!isInt(pv.major) || !isInt(pv.minor))
                return MALFORMED;
            if (!isHandle(v.handle))
                return MALFORMED;
            return { ok: true, message: { type: 'connect', protocolVersion: { major: pv.major, minor: pv.minor }, handle: v.handle } };
        }
        case 'authenticate': {
            if (!isNonEmptyStr(v.signature) || v.signature.length > LIMITS.signatureB64MaxLen)
                return MALFORMED;
            return { ok: true, message: { type: 'authenticate', signature: v.signature } };
        }
        case 'register': {
            if (!isRid(v.rid))
                return MALFORMED;
            if (!isKeyB64(v.authKey))
                return MALFORMED;
            if (!isUint(v.deviceId))
                return MALFORMED;
            if (!isPushRegistration(v.push))
                return MALFORMED;
            return {
                ok: true,
                message: {
                    type: 'register',
                    rid: v.rid,
                    authKey: v.authKey,
                    deviceId: v.deviceId,
                    push: v.push,
                },
            };
        }
        case 'send': {
            if (!isRid(v.rid))
                return MALFORMED;
            if (!isHandle(v.to))
                return MALFORMED;
            if (!isEnvelope(v.envelope))
                return MALFORMED;
            return { ok: true, message: { type: 'send', rid: v.rid, to: v.to, envelope: v.envelope } };
        }
        case 'ack': {
            if (!isNonEmptyStr(v.id) || v.id.length > LIMITS.idMaxLen)
                return MALFORMED;
            return { ok: true, message: { type: 'ack', id: v.id } };
        }
        case 'ping': {
            if (!isInt(v.ts))
                return MALFORMED;
            return { ok: true, message: { type: 'ping', ts: v.ts } };
        }
        case 'deregister': {
            if (!isRid(v.rid))
                return MALFORMED;
            return { ok: true, message: { type: 'deregister', rid: v.rid } };
        }
        case 'turnCredentials': {
            if (!isRid(v.rid))
                return MALFORMED;
            return { ok: true, message: { type: 'turnCredentials', rid: v.rid } };
        }
        default:
            return MALFORMED;
    }
}
//# sourceMappingURL=validate.js.map