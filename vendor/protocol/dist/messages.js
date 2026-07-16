// The typed wire messages exchanged over the WebSocket between a Nuco client and the
// relay. Every payload that carries message content is opaque base64 ciphertext; the
// relay never inspects it. JSON text frames are used so the protocol stays auditable.
// ---------------------------------------------------------------------------
// Runtime type catalogs. The Record types force exhaustiveness at compile time:
// adding a message variant without listing it here is a type error, and the drift
// checker uses these arrays to confirm PROTOCOL.md documents every message.
// ---------------------------------------------------------------------------
const CLIENT_MESSAGE_TYPE_MAP = {
    connect: true,
    authenticate: true,
    register: true,
    send: true,
    ack: true,
    ping: true,
    deregister: true,
    turnCredentials: true,
    report: true,
};
const SERVER_MESSAGE_TYPE_MAP = {
    connected: true,
    authenticated: true,
    ok: true,
    turnCredentialsResult: true,
    deliver: true,
    error: true,
    pong: true,
};
export const CLIENT_MESSAGE_TYPES = Object.keys(CLIENT_MESSAGE_TYPE_MAP);
export const SERVER_MESSAGE_TYPES = Object.keys(SERVER_MESSAGE_TYPE_MAP);
//# sourceMappingURL=messages.js.map