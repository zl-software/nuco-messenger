// Account deletion. Required by the app stores for any app that creates an account. It first
// asks the relay to delete the server side record (device record and queued messages), then
// wipes every local trace, returning the app to a clean onboarding state.

import { deleteDatabaseFile } from '@/db/client';
import { wipeSecrets } from '@/crypto/secure-storage';
import { DEFAULT_PREFS } from '@/services/prefs';
import { resetSignal } from '@/services/account';
import { getRelay, stopRelay } from '@/services/relay';
import { stopExpirySweeper } from '@/services/expiry';
import { wipeAllChatLockSecrets } from '@/lock/chat-locks';
import { lock } from '@/lock/lock-controller';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

// Tear down all local account state: relay, sweeper, encrypted database, keystore secrets, and
// preferences (which resets onboardingComplete). Shared by account deletion and the dev reset.
export async function wipeLocalData(): Promise<void> {
  try {
    stopRelay();
  } catch {
    // ignore
  }
  stopExpirySweeper();
  try {
    await lock();
  } catch {
    // ignore
  }
  try {
    // Before the database goes: the per chat lock keystore index walk needs no db, but
    // the items must not outlive the account (the iOS Keychain survives reinstalls).
    await wipeAllChatLockSecrets();
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
    // Reset prefs both on disk and in the live store so routing returns to onboarding.
    await useSettings.getState().update({ ...DEFAULT_PREFS });
  } catch {
    // ignore
  }
  resetSignal();
  useSession.getState().setAccount(null);
}

// Delete the account: best effort server side deregister, then wipe everything locally. The
// local wipe always runs, so a temporarily unreachable relay never blocks deletion.
export async function deleteAccount(): Promise<void> {
  const relay = getRelay();
  if (relay) {
    try {
      await relay.deregister();
    } catch {
      // The relay also drops accounts whose keys are gone; proceed with the local wipe.
    }
  }
  await wipeLocalData();
}
