// The device implementation of the libsignal backend: the local Expo module in
// modules/nuco-libsignal, which wraps the official prebuilt libsignal cores (Swift and
// Kotlin). This is the ONLY file that imports the native module. The module's API is
// shaped exactly like LibsignalBackend, so this is a pass through; the indirection
// exists so signal.ts never references native code and stays importable on Node.

import { getNativeLibsignal } from '../../modules/nuco-libsignal';
import type { LibsignalBackend } from './backend';

let cached: LibsignalBackend | null = null;

export function nativeBackend(): LibsignalBackend {
  if (!cached) cached = getNativeLibsignal();
  return cached;
}
