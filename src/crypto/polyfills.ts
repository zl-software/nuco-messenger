// Crypto polyfills. Import this FIRST in the app entry, before anything that touches
// crypto. Hermes does not provide crypto.getRandomValues or a Buffer global, both of which
// the Signal library and its dependencies expect.

import * as ExpoCrypto from 'expo-crypto';
import { Buffer } from 'buffer';

import { installCryptoProvider } from './provider';

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
  // The npm "buffer" polyfill package (aliased in metro.config.js). Some Signal dependencies
  // expect a global Buffer in Hermes.
  globalAny.Buffer = Buffer;
}

installCryptoProvider();
