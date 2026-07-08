// Singleton relay client wiring. The app holds one connection; incoming messages are routed
// to the messaging service, and status changes to the session store.

import { ErrorCode } from '@nuco/protocol';

import { RelayClient, type RegisterParams, type RelayStatus, type WebSocketCtor } from '@/transport/relay';
import type { MessageEnvelope } from '@nuco/protocol';
import { useSession } from '@/state/session';
import { attestProvider } from './attest';
import type { Account } from './account';

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

export function startRelay(url: string, account: Account, registerOnConnect?: RegisterParams): RelayClient {
  if (client) return client;
  const WebSocketImpl = (globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket;
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
      // Registration gating verdicts are terminal for this connection attempt: stop the
      // reconnect loop (no point re-attesting on a timer) and surface a banner whose
      // retry calls reconnectRelay for a fresh socket, challenge, and attestation.
      if (code === ErrorCode.AttestationRequired || code === ErrorCode.AttestationFailed) {
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
