// The 60 digit safety number, computed by libsignal's numeric fingerprint generator
// (iterated SHA-512) via NucoSignal.verificationStrings. Both devices derive the SAME
// number from the two identity public keys, so the two people can compare it in person
// to confirm they hold each other's real key. This is the trust anchor for verification.
// Only the pure formatting lives here; the computation needs the backend and sits in
// signal.ts.

// Format the 60 digits into three rows of two 5 digit groups, matching the design.
export function formatSafetyNumber(safetyNumber: string): string[] {
  const groups = safetyNumber.match(/.{1,5}/g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += 2) {
    rows.push(groups.slice(i, i + 2).join(' '));
  }
  return rows;
}
