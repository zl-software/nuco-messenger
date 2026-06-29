// Development helpers. Not used in production paths.

import { reloadAppAsync } from 'expo';

import { deleteDatabaseFile } from '@/db/client';
import { wipeSecrets } from '@/crypto/secure-storage';
import { DEFAULT_PREFS, savePrefs } from '@/services/prefs';
import { resetSignal } from '@/services/account';
import { stopRelay } from '@/services/relay';
import { lock } from '@/lock/lock-controller';
import { useSession } from '@/state/session';

// Wipe all keys and data and return to onboarding. Reachable from the dev menu. This deletes
// the encrypted database, the hardware keystore secrets, and all preferences, then reloads.
export async function devReset(): Promise<void> {
  try {
    stopRelay();
  } catch {
    // ignore
  }
  try {
    await lock();
  } catch {
    // ignore
  }
  try {
    await deleteDatabaseFile();
  } catch {
    // ignore
  }
  try {
    await wipeSecrets();
  } catch {
    // ignore
  }
  try {
    await savePrefs({ ...DEFAULT_PREFS });
  } catch {
    // ignore
  }
  resetSignal();
  useSession.getState().setAccount(null);
  await reloadAppAsync();
}
