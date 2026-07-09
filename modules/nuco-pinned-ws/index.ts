// JS wrapper for the URLSession WebSocket, matching the WebSocketLike shape the relay
// transport expects (see src/transport/relay.ts: send(string), close() with no args,
// nullable onopen/onmessage/onclose/onerror where onmessage receives { data }). The
// ONLY consumer is the WebSocket implementation picker in src/services/relay.ts.

import type { EventSubscription } from 'expo-modules-core';

interface NativeWs {
  connect(url: string): number;
  send(id: number, data: string): void;
  close(id: number): void;
  addListener(event: string, listener: (event: Record<string, unknown>) => void): EventSubscription;
}

let native: NativeWs | null | undefined;

function loadNative(): NativeWs | null {
  if (native !== undefined) return native;
  try {
    // Lazy require so a dev client built before this module existed degrades to the RN
    // global WebSocket instead of crashing at import time (see services/attest.ts for
    // the same pattern).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core') as {
      requireNativeModule: (name: string) => NativeWs;
    };
    native = requireNativeModule('NucoPinnedWs');
  } catch {
    native = null;
  }
  return native;
}

class PinnedWebSocket {
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  private readonly id: number;
  private subscriptions: EventSubscription[];

  constructor(url: string) {
    const module = loadNative()!; // the ctor is only handed out when loadNative() succeeded
    this.id = module.connect(url);
    const on = (event: string, handler: (e: Record<string, unknown>) => void): EventSubscription =>
      module.addListener(event, (e) => {
        if (e.id === this.id) handler(e);
      });
    this.subscriptions = [
      on('onOpen', () => this.onopen?.()),
      on('onMessage', (e) => this.onmessage?.({ data: e.data })),
      on('onError', (e) => {
        if (__DEV__) console.warn('[pinned-ws] socket error', e.domain, e.code);
        this.onerror?.(e);
      }),
      on('onClose', (e) => {
        this.onclose?.(e);
        this.dispose();
      }),
    ];
  }

  send(data: string): void {
    loadNative()?.send(this.id, data);
  }

  close(): void {
    loadNative()?.close(this.id);
  }

  private dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
  }
}

// Null when the native module is not in this binary (a stale dev client).
export function getPinnedWebSocketCtor(): (new (url: string) => PinnedWebSocket) | null {
  return loadNative() ? PinnedWebSocket : null;
}
