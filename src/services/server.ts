// Resolves the relay WebSocket URL. Local dev builds can point at a local relay via the
// EXPO_PUBLIC_RELAY_URL env var; otherwise the dev build defaults to nuco-dev and the
// production build to relay.nuco-messenger.com. A custom server in Settings overrides all.

import type { Prefs } from './prefs';

const DEV_DEFAULT = 'wss://nuco-dev.zlsoftware.at';
const PROD_DEFAULT = 'wss://relay.nuco-messenger.com';

function withScheme(address: string): string {
  if (address.startsWith('ws://') || address.startsWith('wss://')) return address;
  return `wss://${address}`;
}

export function defaultServerUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_RELAY_URL;
  if (fromEnv) return fromEnv;
  return __DEV__ ? DEV_DEFAULT : PROD_DEFAULT;
}

export function resolveServerUrl(prefs: Prefs): string {
  if (prefs.serverMode === 'custom' && prefs.customServer) {
    return withScheme(prefs.customServer);
  }
  return defaultServerUrl();
}

// HTTP base for the health check (test connection), derived from the ws url.
export function healthUrlFor(wsUrl: string): string {
  const httpUrl = wsUrl.replace(/^ws/, 'http');
  return `${httpUrl.replace(/\/$/, '')}/health`;
}
