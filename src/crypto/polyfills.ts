// Crypto polyfills. Import this FIRST in the app entry, before anything that touches
// crypto. Hermes does not provide crypto.getRandomValues or a Buffer global, both of which
// the Signal library and its dependencies expect.

import * as ExpoCrypto from 'expo-crypto';

import { installCryptoProvider } from './provider';

// Metro provides require at runtime; declare it locally so this stays type clean without
// pulling in Node type definitions.
declare const require: (id: string) => unknown;

const globalAny = globalThis as unknown as {
  crypto?: { getRandomValues?: (array: ArrayBufferView) => ArrayBufferView };
  Buffer?: unknown;
};

if (!globalAny.crypto) {
  globalAny.crypto = {};
}
if (typeof globalAny.crypto.getRandomValues !== 'function') {
  globalAny.crypto.getRandomValues = (array) => ExpoCrypto.getRandomValues(array as never);
}
if (!globalAny.Buffer) {
  // The npm "buffer" polyfill package, bundled by Metro. Some Signal dependencies expect a
  // global Buffer in Hermes.
  globalAny.Buffer = (require('buffer') as { Buffer: unknown }).Buffer;
}

installCryptoProvider();
