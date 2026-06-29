// The 60 digit safety number, computed with the Signal library's fingerprint generator
// (iterated SHA-512). Both devices derive the SAME number from the two identity public
// keys, so the two people can compare it in person to confirm they hold each other's real
// key. This is the trust anchor for verification.

import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript';

import { base64ToAb } from './bytes';

const ITERATIONS = 5200;

export async function computeSafetyNumber(
  localIdentifier: string,
  localIdentityKeyB64: string,
  remoteIdentifier: string,
  remoteIdentityKeyB64: string,
): Promise<string> {
  const generator = new FingerprintGenerator(ITERATIONS);
  return generator.createFor(
    localIdentifier,
    base64ToAb(localIdentityKeyB64),
    remoteIdentifier,
    base64ToAb(remoteIdentityKeyB64),
  );
}

// Format the 60 digits into three rows of two 5 digit groups, matching the design.
export function formatSafetyNumber(safetyNumber: string): string[] {
  const groups = safetyNumber.match(/.{1,5}/g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += 2) {
    rows.push(groups.slice(i, i + 2).join(' '));
  }
  return rows;
}
