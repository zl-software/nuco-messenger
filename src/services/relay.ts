// Singleton relay client wiring. The app holds one connection; incoming messages are routed
// to the messaging service, and status changes to the session store.

import { Platform } from 'react-native';

import { ErrorCode } from '@nuco/protocol';

import { RelayClient, type RegisterParams, type RelayStatus, type WebSocketCtor } from '@/transport/relay';
import type { MessageEnvelope } from '@nuco/protocol';
import { useSession } from '@/state/session';
import { getPinnedWebSocketCtor } from '../../modules/nuco-pinned-ws';
import { attestProvider } from './attest';
import type { Account } from './account';
import { isPinnedRelayUrl } from './server';

let client: RelayClient | null = null;

type DeliverHandler = (from: string, envelope: MessageEnvelope) => void | Promise<void>;
let deliverHandler: DeliverHandler = () => {};
let statusHandler: (status: RelayStatus) => void = () => {};

export function setOnDeliver(fn: DeliverHandler): void {
  deliverHandler = fn;
}
export function setOnRelayStatus(fn: (status: RelayStatus) => void): void {
  statusHandler = fn;
}

// The reference relay's socket goes through the URLSession based native module on iOS,
// which puts it inside ATS so the NSPinnedDomains certificate pins apply (RN's own
// WebSocket rides SocketRocket over raw streams, which ATS never sees). Custom relays,
// LAN ws:// dev, and Android stay on the RN global WebSocket, unpinned by design. A dev
// client built before the module existed degrades to the global with a warning.
function pickWebSocketImpl(url: string): WebSocketCtor {
  if (Platform.OS === 'ios' && isPinnedRelayUrl(url)) {
    const pinned = getPinnedWebSocketCtor();
    if (pinned) return pinned as unknown as WebSocketCtor;
    if (__DEV__) console.warn('[relay] pinned websocket module unavailable, using the global WebSocket');
  }
  return (globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket;
}

export function startRelay(url: string, account: Account, registerOnConnect?: RegisterParams): RelayClient {
  if (client) return client;
  const WebSocketImpl = pickWebSocketImpl(url);
  useSession.getState().setRegistrationError(null);
  client = new RelayClient({
    url,
    handle: account.handle,
    authKeyPair: account.authKeyPair,
    WebSocketImpl,
    registerOnConnect,
    attestProvider,
    autoReconnect: true,
    onDeliver: (from, envelope) => deliverHandler(from, envelope),
    onStatus: (status) => statusHandler(status),
    onError: (code) => {
      // Registration gating verdicts and operator bans are terminal for this connection
      // attempt: stop the reconnect loop (no point re-attesting or re-authing on a timer)
      // and surface a banner whose retry calls reconnectRelay for a fresh socket,
      // challenge, and attestation.
      if (code === ErrorCode.AttestationRequired || code === ErrorCode.AttestationFailed || code === ErrorCode.Banned) {
        useSession.getState().setRegistrationError(code);
        stopRelay();
      }
    },
  });
  client.start();
  return client;
}

export function getRelay(): RelayClient | null {
  return client;
}

export function stopRelay(): void {
  client?.stop();
  client = null;
}
