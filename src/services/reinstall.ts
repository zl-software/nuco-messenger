// Reinstall guard. On iOS the Keychain (expo-secure-store) survives deleting the app: the
// prefs (including onboardingComplete) and the wrapped database keys come back on a fresh
// install, while the SQLCipher database in the app sandbox is gone. Without this guard the
// app skips onboarding, accepts the old PIN, and opens an empty database with no account:
// an unusable half state (no identity, no QR code, no relay signature). Detect it before
// routing: if the prefs claim onboarding finished but the database file does not exist,
// wipe the leftover keystore entries so the app starts clean at onboarding.

import { wipeSecrets } from '@/crypto/secure-storage';
import { databaseFileExists } from '@/db/client';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';

export async function resetIfReinstalled(): Promise<void> {
  try {
    const prefs = await loadPrefs();
    if (!prefs.onboardingComplete) return;
    if (databaseFileExists()) return;
    await wipeSecrets();
    await savePrefs({ ...DEFAULT_PREFS });
  } catch {
    // Never block boot on the guard.
  }
}
