// Hermes' built in TextDecoder supports only utf-8. The bundled emscripten curve module
// (@privacyresearch/curve25519-typescript) eagerly runs `new TextDecoder('utf-16le')` at
// load time, which throws a RangeError on Hermes and brings down the whole app. We install a
// TextDecoder that also handles utf-16le BEFORE that module loads. This file is imported
// first by crypto/polyfills, ahead of anything that pulls in the Signal library.
//
// utf-8 decoding still delegates to the native decoder when present (correct and fast); only
// utf-16le is handled here.

const g = globalThis as unknown as { TextDecoder?: new (label?: string) => { decode(input?: ArrayBuffer | ArrayBufferView): string } };
const Native = g.TextDecoder;

function nativeHandlesUtf16(): boolean {
  if (!Native) return false;
  try {
    new Native('utf-16le');
    return true;
  } catch {
    return false;
  }
}

function isUtf16(label: string): boolean {
  return label === 'utf-16le' || label === 'utf16le' || label === 'ucs2' || label === 'ucs-2';
}

function toBytes(input?: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

function decodeUtf16le(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  return s;
}

function decodeUtf8(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++]!;
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++]! & 0x3f));
    else if (b < 0xf0) s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f));
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
      const off = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return s;
}

if (!nativeHandlesUtf16()) {
  class CompatTextDecoder {
    readonly encoding: string;
    private native?: { decode(input?: ArrayBuffer | ArrayBufferView): string };
    constructor(label: string = 'utf-8') {
      this.encoding = String(label).toLowerCase();
      if (Native && !isUtf16(this.encoding)) {
        this.native = new Native(label);
      }
    }
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (this.native) return this.native.decode(input);
      const bytes = toBytes(input);
      return isUtf16(this.encoding) ? decodeUtf16le(bytes) : decodeUtf8(bytes);
    }
  }
  g.TextDecoder = CompatTextDecoder as unknown as typeof Native;
}
