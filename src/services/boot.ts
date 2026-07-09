// Brings the app online after the encrypted database is open (post unlock or right after
// onboarding): loads the account, wires inbound delivery to the messaging service, and
// starts the relay connection.

import { loadAccount, registerParamsFor, type Account } from './account';
import { startRelay, stopRelay, setOnDeliver, setOnRelayStatus, getRelay } from './relay';
import { initCallService } from './calls';
import { emitConversationsChanged } from './data-events';
import { receiveEnvelope, resendPendingOutbound } from './messaging';
import { resendPendingNameSyncs } from './profile';
import { initVerificationService, resendPendingConfirms } from './verification';
import { startExpirySweeper } from './expiry';
import { resolveServerUrl } from './server';
import { loadPrefs } from './prefs';
import { useSession } from '@/state/session';
import { initChatLocks, sealPendingForLockedChats } from '@/lock/chat-locks';
import { sweepExpired } from '@/db/repos/messages';
import { registerPush } from '@/transport/push';

function wireRelayCallbacks(): void {
  // The call controller and the verification handlers must be registered before the relay
  // can deliver the first envelope, or an early signal would hit the default no-op handler.
  initCallService();
  initVerificationService();
  setOnRelayStatus((status) => {
    useSession.getState().setRelayStatus(status);
    // Re-send unanswered verification confirms on every connect (idempotent), so a lost
    // or TTL expired confirm never leaves a pair stuck pending. Same for a rename that
    // has not reached every contact yet (receivers skip an unchanged name).
    if (status === 'connected') {
      void resendPendingConfirms();
      void resendPendingNameSyncs();
    }
  });
  setOnDeliver(async (from, envelope) => {
    await receiveEnvelope(from, envelope);
  });
}

// First run, right after onboarding provisioning. Registers the device on connect.
export async function goOnlineFirstRun(account: Account): Promise<void> {
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  initChatLocks();
  wireRelayCallbacks();
  startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  startExpirySweeper();
  void registerPush();
}

// Returning user, after unlock.
export async function bringOnline(): Promise<void> {
  const account = await loadAccount();
  if (!account) return;
  useSession.getState().setAccount(account);
  const prefs = await loadPrefs();
  initChatLocks();
  wireRelayCallbacks();
  // Register on connect: a self hosted relay (or one whose store was reset) will not know this
  // handle, and authentication fails without a registration, leaving the socket disconnected.
  startRelay(resolveServerUrl(prefs), account, registerParamsFor(account, { kind: 'none' }));
  if ((await sweepExpired(Date.now())) > 0) emitConversationsChanged();
  startExpirySweeper();
  // Re-send anything left 'sending' when the app was last killed (the outbound queue is memory
  // only). Fire in the background so it does not gate coming online.
  void resendPendingOutbound();
  // Self heal a crash mid chat-lock-enable: seal any plaintext rows left in locked chats.
  void sealPendingForLockedChats();
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
}

export function relayConnected(): boolean {
  return getRelay()?.isConnected() ?? false;
}
