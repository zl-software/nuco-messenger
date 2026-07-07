// The decrypted plaintext payload carried inside a sealed MessageEnvelope. The relay never
// sees this: it is end to end encrypted, padded, then sealed. Wrapping every message in a
// typed content envelope lets peers carry control messages (disappearing message requests)
// on the same channel as ordinary text, without the relay learning anything new.
//
// This is part of the wire contract between two peers (not between client and relay), so it
// lives here in @nuco/protocol. Adding a content variant is a backward compatible (minor)
// change: a peer that does not understand a variant decodes it as `unknown` (structured
// content it can drop silently) or as text (anything unstructured), never as a crash.
const encoder = new TextEncoder();
const decoder = new TextDecoder(); // utf-8
// Bounds enforced on decode so a malicious or buggy peer cannot make the receiver store or
// render an unbounded body, nor set a retention so large that expiry arithmetic overflows.
// A text body of up to 16384 UTF-16 units always fits within the largest padding bucket
// (65536 bytes) even at the 4 byte per unit worst case. The retention ceiling (365 days)
// covers every offered option while keeping now + value*1000 far below MAX_SAFE_INTEGER.
export const MESSAGE_BODY_MAX_LEN = 16384;
export const RETENTION_MAX_SECONDS = 365 * 24 * 60 * 60;
// Voice call signaling bounds and shared timing. The sdp cap is a safety ceiling well above
// an audio only, relay only offer or answer (roughly 1 to 3 KB, which pads into the 4096
// bucket). Both sides time the ring against CALL_RING_TIMEOUT_SECONDS; the caller MUST send
// `call/end` with reason `timeout` when it fires, so a queued offer is always followed by an
// authoritative end marker. A receiver rings only if localReceiveTime - envelope.sentAt <
// CALL_OFFER_STALE_SECONDS * 1000 and treats an older offer as a missed call (no ring, no
// reply). The window tolerates sender clocks up to (window - ring timeout - delivery delay)
// behind before rings start being suppressed (75s of skew at these values); a wider window
// costs little because late ghost rings are already bounded by the caller's trailing end
// marker (delivered in order right behind the offer) and the callee's own local ring timer.
export const CALL_ID_MAX_LEN = 64;
export const CALL_SDP_MAX_LEN = 8192;
export const CALL_END_REASON_MAX_LEN = 32;
export const CALL_RING_TIMEOUT_SECONDS = 45;
export const CALL_OFFER_STALE_SECONDS = 120;
// Mutual verification. `verify/confirm` says: this sender scanned the receiver's contact
// card AND confirmed the emoji SAS in person. cardHash proves the scan: it is
// base64(sha256(utf8(handle) || 0x00 || identityKeyBytes || 0x00 || signedPreKeyPublicBytes))
// over the RECEIVER's card (immutable fields only; displayName may change). Since the
// signed prekey distributes only via the QR card and an initiator's own signed prekey never
// appears in the X3DH handshake, only someone who held the card can compute the hash. The
// receiver recomputes it over its own card and ignores the message on mismatch. A sha256
// digest is 32 bytes, so the base64 form is always exactly 44 characters.
export const CARD_HASH_LEN = 44;
// Known call end reasons. The wire field stays an open short string so a reason added in a
// future minor still ends the call on an older peer instead of ringing through the timeout.
export const CALL_END_REASONS = ['hangup', 'decline', 'busy', 'timeout', 'error'];
// Force exhaustiveness: adding a variant without listing it here is a type error.
const MESSAGE_CONTENT_TYPE_MAP = {
    text: true,
    'retention/request': true,
    'retention/accept': true,
    'retention/cancel': true,
    'screenshot/request': true,
    'screenshot/accept': true,
    'screenshot/cancel': true,
    'call/offer': true,
    'call/answer': true,
    'call/end': true,
    'verify/confirm': true,
};
export const MESSAGE_CONTENT_TYPES = Object.keys(MESSAGE_CONTENT_TYPE_MAP);
export function encodeContent(content) {
    return encoder.encode(JSON.stringify(content));
}
// Decode bytes into a typed content. Tolerant by design: unstructured bytes (plain text,
// malformed JSON) degrade to a text body so a nonconforming but honest peer still renders
// as a message. Structured content with an unrecognized `t` decodes as `unknown` instead,
// so control payloads from a newer peer are dropped silently rather than rendered as raw
// JSON text. Every conforming sender wraps user text as { t: 'text' }, so hand typed JSON
// in a message body never reaches the unknown branch.
export function decodeContent(bytes) {
    const text = decoder.decode(bytes);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { t: 'text', body: text };
    }
    if (isMessageContent(parsed))
        return parsed;
    if (typeof parsed === 'object' && parsed !== null) {
        const o = parsed;
        if (typeof o.t === 'string') {
            // An oversized text body is truncated rather than dropped, preserving the documented
            // cap for nonconforming senders.
            if (o.t === 'text' && typeof o.body === 'string') {
                return { t: 'text', body: o.body.slice(0, MESSAGE_BODY_MAX_LEN) };
            }
            return { t: 'unknown', originalType: o.t.slice(0, 64) };
        }
    }
    return { t: 'text', body: text.slice(0, MESSAGE_BODY_MAX_LEN) };
}
function isMessageContent(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const o = v;
    switch (o.t) {
        case 'text':
            return typeof o.body === 'string' && o.body.length <= MESSAGE_BODY_MAX_LEN;
        case 'retention/request':
        case 'retention/accept':
            return (typeof o.value === 'number' &&
                Number.isFinite(o.value) &&
                o.value >= 0 &&
                o.value <= RETENTION_MAX_SECONDS);
        case 'retention/cancel':
            return true;
        case 'screenshot/request':
        case 'screenshot/accept':
            return typeof o.on === 'boolean';
        case 'screenshot/cancel':
            return true;
        case 'call/offer':
        case 'call/answer':
            return (typeof o.callId === 'string' &&
                o.callId.length > 0 &&
                o.callId.length <= CALL_ID_MAX_LEN &&
                typeof o.sdp === 'string' &&
                o.sdp.length > 0 &&
                o.sdp.length <= CALL_SDP_MAX_LEN);
        case 'call/end':
            return (typeof o.callId === 'string' &&
                o.callId.length > 0 &&
                o.callId.length <= CALL_ID_MAX_LEN &&
                typeof o.reason === 'string' &&
                o.reason.length > 0 &&
                o.reason.length <= CALL_END_REASON_MAX_LEN);
        case 'verify/confirm':
            return typeof o.cardHash === 'string' && o.cardHash.length === CARD_HASH_LEN;
        default:
            return false;
    }
}
// Glare: both peers place a call to each other at the same time. Both sides resolve it
// without an extra round trip by comparing the two call ids with plain code unit order:
// the smaller call id wins and its offer proceeds; the losing side silently abandons its
// own offer (no `call/end` needed, both peers derive the same result) and answers the
// winning offer.
export function callOfferWins(localCallId, remoteCallId) {
    return localCallId < remoteCallId;
}
//# sourceMappingURL=content.js.map