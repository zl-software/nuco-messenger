// Crypto polyfills. Import this FIRST in the app entry, before anything that touches
// crypto. Hermes does not provide crypto.getRandomValues (which @noble needs for the
// transport auth key, SAS, and chat lock crypto) or a Buffer global (which the qrcode
// dependency of react-native-qrcode-svg expects; the npm "buffer" package is aliased in
// metro.config.js).

import * as ExpoCrypto from 'expo-crypto';
import { Buffer } from 'buffer';

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
  globalAny.Buffer = Buffer;
}
