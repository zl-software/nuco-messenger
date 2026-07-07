// The single wire protocol version shared by the Nuco client and relay.
// The relay rejects a connection whose MAJOR version does not match.
export const PROTOCOL_VERSION = { major: 2, minor: 2 };
export const PROTOCOL_VERSION_STRING = `${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor}`;
// Two peers are compatible when their MAJOR versions match. A higher MINOR is
// treated as backward compatible: unknown optional fields are ignored.
export function isMajorCompatible(remote) {
    return Number.isInteger(remote.major) && remote.major === PROTOCOL_VERSION.major;
}
//# sourceMappingURL=version.js.map