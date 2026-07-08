// App Attest provider for registration gating: the reference relay only creates new
// handles for genuine builds of the official app (see PROTOCOL.md, "App attestation").
// This is the ONLY file that may import @expo/app-integrity.
//
// The challenge is passed to DCAppAttestService as the base64 STRING from the connected
// frame; the native layer hashes its UTF-8 bytes (never the decoded nonce), which is
// exactly what the relay verifies against. A fresh key is generated per attempt: keys
// are free, the relay discards them after verification, and a failed attempt must not
// pin a stale key.

import { Platform } from 'react-native';

import type { RegisterAttestation } from '@nuco/protocol';

export async function attestProvider(challenge: string): Promise<RegisterAttestation | null> {
  if (Platform.OS !== 'ios') return null;
  let integrity: typeof import('@expo/app-integrity');
  try {
    // Lazy require so a dev client built before this module existed degrades to
    // "cannot attest" instead of crashing at import time.
    integrity = require('@expo/app-integrity');
  } catch {
    return null;
  }
  if (!integrity.isSupported) return null;
  const keyId = await integrity.generateKeyAsync();
  const data = await integrity.attestKeyAsync(keyId, challenge);
  return { kind: 'apple-app-attest', keyId, data };
}
