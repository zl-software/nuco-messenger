// Byte and encoding helpers used across the crypto layer. Self contained so the same code
// runs in Hermes (the app) and in Node (the end to end harness), with no reliance on
// btoa/atob or Buffer being present.

export function u8(x: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(x);
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: number[] = (() => {
  const table = new Array<number>(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const len = bytes.length;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  let clean = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c === 61 /* = */ || (B64_LOOKUP[c] ?? -1) !== -1) clean++;
  }
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((clean * 3) / 4) - padding;
  const out = new Uint8Array(outLen);
  let bits = 0;
  let value = 0;
  let p = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = B64_LOOKUP[b64.charCodeAt(i)] ?? -1;
    if (v === -1) continue;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

export function abToBase64(ab: ArrayBuffer | ArrayBufferView): string {
  return bytesToBase64(u8(ab));
}

// Lexicographic byte order. Used wherever both peers must derive the same result from a
// pair of keys regardless of who computes it (the SAS sort, the session initiator rule).
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

export function base64ToAb(b64: string): ArrayBuffer {
  return toArrayBuffer(base64ToBytes(b64));
}

// The Signal cipher returns its message body as a binary string (one char per byte).
export function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// The replacement character emitted for malformed input, matching what a real TextEncoder/
// TextDecoder produces, so the fallback degrades the same way rather than emitting garbage.
const REPLACEMENT = [0xef, 0xbf, 0xbd];

export function utf8Encode(s: string): Uint8Array {
  if (te) return te.encode(s);
  // Minimal UTF-8 encoder fallback with surrogate validation.
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: must be followed by a low surrogate to form a code point.
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        i++;
        c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        out.push(...REPLACEMENT); // unpaired high surrogate
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(...REPLACEMENT); // unpaired low surrogate
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  if (td) return td.decode(bytes);
  let s = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i++]!;
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if (b < 0xe0) {
      // 2 byte sequence: needs one continuation byte.
      if (i >= n) {
        s += String.fromCharCode(0xfffd);
        break;
      }
      s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++]! & 0x3f));
    } else if (b < 0xf0) {
      // 3 byte sequence: needs two continuation bytes.
      if (i + 1 >= n) {
        s += String.fromCharCode(0xfffd);
        break;
      }
      s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f));
    } else {
      // 4 byte sequence: needs three continuation bytes.
      if (i + 2 >= n) {
        s += String.fromCharCode(0xfffd);
        break;
      }
      const cp = ((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
      const off = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return s;
}
