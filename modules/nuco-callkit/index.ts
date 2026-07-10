// Typed entry for the NucoCallkit native module. The ONLY importer is
// src/calls/callkit.ts, which also provides the no-op fallback for platforms and
// binaries without the module (Android, stale dev clients). All uuids are CallKit call
// UUID strings; caller names are display strings only (never handles or key material).

import type { EventSubscription } from 'expo-modules-core';

export interface PendingCall {
  uuid: string;
  reportedAt: number;
  answered: boolean;
}

export interface NucoCallkitNative {
  getVoipToken(): string | null;
  getPendingCalls(): PendingCall[];
  consumePendingCall(uuid: string): void;
  reportIncomingCall(callerName: string): Promise<string>;
  updateCaller(uuid: string, callerName: string): void;
  startOutgoingCall(calleeName: string): Promise<string>;
  reportOutgoingConnected(uuid: string): void;
  endCallLocal(uuid: string): Promise<void>;
  reportCallEnded(
    uuid: string,
    reason: 'remoteEnded' | 'unanswered' | 'failed' | 'answeredElsewhere' | 'declinedElsewhere',
  ): void;
  addListener(event: string, listener: (event: Record<string, unknown>) => void): EventSubscription;
}

let native: NucoCallkitNative | null | undefined;

export function getNucoCallkit(): NucoCallkitNative | null {
  if (native !== undefined) return native;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core') as {
      requireNativeModule: (name: string) => NucoCallkitNative;
    };
    native = requireNativeModule('NucoCallkit');
  } catch {
    native = null;
  }
  return native;
}
