// Development helpers. Not used in production paths.

import { reloadAppAsync } from 'expo';

import { wipeLocalData } from '@/services/account-delete';

// Wipe all keys and data and return to onboarding. Reachable from the dev menu. This deletes
// the encrypted database, the hardware keystore secrets, and all preferences, then reloads.
export async function devReset(): Promise<void> {
  await wipeLocalData();
  await reloadAppAsync();
}
