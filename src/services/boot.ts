// Brings the app online after the encrypted database is open (post unlock or right after
// onboarding): loads the account, wires inbound delivery to the messaging service, and
// starts the relay connection.

import { loadAccount, registerParamsFor, generatePreKeyUpload, type Account } from './account';
import { startRelay, stopRelay, setOnDeliver, setOnRelayStatus, getRelay } from './relay';
import { receiveEnvelope } from './messaging';
import { resolveServerUrl } from './server';
import { loadPrefs } from './prefs';
import { useSession } from '@/state/session';
import { sweepExpired } from '@/db/repos/messages';
import { registerPush } from '@/transport/push';

function wireRelayCallbacks(): void {
  setOnRelayStatus((status) => useSession.getState().setRelayStatus(status));
  setOnDeliver(async (from, envelope) => {
    await receiveEnvelope(from, envelope);
  });
}

// Self heal prekeys: if the relay we just connected to holds no bundle for us (a self hosted or
// reset relay that we did not onboard against), publish a fresh batch so others can start a
// session with us. Best effort and runs in the background.
async function ensurePreKeysPublished(): Promise<void> {
  const relay = getRelay();
  if (!relay) return;
  try {
    if (!(await relay.waitUntilReady(8000))) return;
    const count = await relay.preKeyCount();
    if (count.hasSignedPreKey && count.oneTimeCount > 0) return;
    const upload = await generatePreKeyUpload();
    if (upload) await relay.publishPreKeys(upload);
  } catch {
    // A later connect retries.
  }
}

// First run, right after onboarding provisioning. Registers the device and publishes prekeys.
export async function goOnlineFirstRun(account: Account, upload: import('@nuco/protocol').PreKeyUpload): Promise<void> {
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  wireRelayCallbacks();
  const client = startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  await client.ensureReady();
  await client.publishPreKeys(upload);
  void registerPush();
}

// Returning user, after unlock.
export async function bringOnline(): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  wireRelayCallbacks();
  // Register on connect: a self hosted relay (or one whose store was reset) will not know this
  // handle, and authentication fails without a registration, leaving the socket disconnected.
  startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  void ensurePreKeysPublished();
  await sweepExpired(Date.now());
  void registerPush();
}

// Reconnect the relay to the currently configured server. The live client keeps the URL it was
// started with, so changing the server in Settings has no effect until we tear it down and
// reopen against the new address.
export async function reconnectRelay(): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  stopRelay();
  const prefs = await loadPrefs();
  wireRelayCallbacks();
  startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  void ensurePreKeysPublished();
}

export function relayConnected(): boolean {
  return getRelay()?.isConnected() ?? false;
}
