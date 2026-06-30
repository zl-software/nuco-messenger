// Resolves the relay WebSocket URL. Local dev builds can point at a local relay via the
// EXPO_PUBLIC_RELAY_URL env var; otherwise the dev build defaults to nuco-dev and the
// production build to relay.nuco-messenger.com. A custom server in Settings overrides all.

import type { Prefs } from './prefs';

const DEV_DEFAULT = 'wss://nuco-dev.zlsoftware.at';
const PROD_DEFAULT = 'wss://relay.nuco-messenger.com';

// A LAN or loopback host is reached over plain ws:// (a local dev relay has no TLS), while a
// public hostname defaults to wss://. The user can always type an explicit scheme to override.
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

// WebSocket needs a ws/wss scheme. An http(s) URL (a common mistake in the env var or the
// custom server field) opens fine for the /health probe but the socket cannot connect, so
// coerce it: https -> wss, http -> ws.
function toWsScheme(url: string): string {
  if (/^https:\/\//i.test(url)) return `wss://${url.slice(8)}`;
  if (/^http:\/\//i.test(url)) return `ws://${url.slice(7)}`;
  return url;
}

function withScheme(address: string): string {
  const trimmed = address.trim();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return toWsScheme(trimmed);
  const host = trimmed.split('/')[0].split(':')[0];
  return `${isLocalHost(host) ? 'ws' : 'wss'}://${trimmed}`;
}

export function defaultServerUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_RELAY_URL;
  if (fromEnv) return toWsScheme(fromEnv.trim());
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
