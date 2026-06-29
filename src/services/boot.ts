// Brings the app online after the encrypted database is open (post unlock or right after
// onboarding): loads the account, wires inbound delivery to the messaging service, and
// starts the relay connection.

import { loadAccount, registerParamsFor, type Account } from './account';
import { startRelay, setOnDeliver, setOnRelayStatus, getRelay } from './relay';
import { receiveEnvelope } from './messaging';
import { resolveServerUrl } from './server';
import { loadPrefs } from './prefs';
import { useSession } from '@/state/session';
import { sweepExpired } from '@/db/repos/messages';

function wireRelayCallbacks(): void {
  setOnRelayStatus((status) => useSession.getState().setRelayStatus(status));
  setOnDeliver(async (from, envelope) => {
    await receiveEnvelope(from, envelope);
  });
}

// First run, right after onboarding provisioning. Registers the device and publishes prekeys.
export async function goOnlineFirstRun(account: Account, upload: import('@nuco/protocol').PreKeyUpload): Promise<void> {
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  wireRelayCallbacks();
  const client = startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  await client.ensureReady();
  await client.publishPreKeys(upload);
}

// Returning user, after unlock.
export async function bringOnline(): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  wireRelayCallbacks();
  startRelay(resolveServerUrl(prefs), account);
  await sweepExpired(Date.now());
}

export function relayConnected(): boolean {
  return getRelay()?.isConnected() ?? false;
}
