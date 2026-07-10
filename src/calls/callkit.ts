// The ONLY importer of the NucoCallkit native module (the same boundary rule engine.ts
// holds for react-native-webrtc). Presents a no-op fallback on Android, on dev clients
// built before the module existed, and on Node, so callers never branch on platform.
// Everything here is display plumbing: call UUIDs and display names, never handles on
// the wire, never key material.

import { Platform } from 'react-native';

import { getNucoCallkit, type NucoCallkitNative, type PendingCall } from '../../modules/nuco-callkit';

export type CallEndReport = 'remoteEnded' | 'unanswered' | 'failed' | 'answeredElsewhere' | 'declinedElsewhere';

export interface CallKitEvents {
  onAnswer: (uuid: string) => void;
  onEnd: (uuid: string) => void;
  onMuted: (uuid: string, muted: boolean) => void;
  onVoipToken: (token: string | null) => void;
  onVoipPush: (uuid: string) => void;
}

export interface CallKitBridge {
  readonly available: boolean;
  init(events: CallKitEvents): void;
  getVoipToken(): string | null;
  pendingCalls(): PendingCall[];
  consumePending(uuid: string): void;
  reportIncoming(callerName: string): Promise<string | null>;
  updateCaller(uuid: string, callerName: string): void;
  startOutgoing(calleeName: string): Promise<string | null>;
  reportConnected(uuid: string): void;
  reportEnded(uuid: string, reason: CallEndReport): void;
  answerLocal(uuid: string): Promise<void>;
  refreshAudio(): void;
}

const NOOP: CallKitBridge = {
  available: false,
  init: () => undefined,
  getVoipToken: () => null,
  pendingCalls: () => [],
  consumePending: () => undefined,
  reportIncoming: async () => null,
  updateCaller: () => undefined,
  startOutgoing: async () => null,
  reportConnected: () => undefined,
  reportEnded: () => undefined,
  answerLocal: async () => undefined,
  refreshAudio: () => undefined,
};

function makeBridge(native: NucoCallkitNative): CallKitBridge {
  return {
    available: true,
    init: (events) => {
      native.addListener('onAnswer', (e) => events.onAnswer(String(e.uuid)));
      native.addListener('onEnd', (e) => events.onEnd(String(e.uuid)));
      native.addListener('onMuted', (e) => events.onMuted(String(e.uuid), e.muted === true));
      native.addListener('onVoipToken', (e) => {
        const token = typeof e.token === 'string' && e.token.length > 0 ? e.token : null;
        events.onVoipToken(token);
      });
      native.addListener('onVoipPush', (e) => events.onVoipPush(String(e.uuid)));
    },
    getVoipToken: () => native.getVoipToken(),
    pendingCalls: () => native.getPendingCalls(),
    consumePending: (uuid) => native.consumePendingCall(uuid),
    reportIncoming: async (callerName) => {
      try {
        return await native.reportIncomingCall(callerName);
      } catch {
        return null;
      }
    },
    updateCaller: (uuid, callerName) => native.updateCaller(uuid, callerName),
    startOutgoing: async (calleeName) => {
      try {
        return await native.startOutgoingCall(calleeName);
      } catch {
        return null;
      }
    },
    reportConnected: (uuid) => native.reportOutgoingConnected(uuid),
    reportEnded: (uuid, reason) => native.reportCallEnded(uuid, reason),
    answerLocal: async (uuid) => {
      try {
        await native.answerCallLocal(uuid);
      } catch {
        // The system call UI just lags behind; the call itself proceeds.
      }
    },
    refreshAudio: () => native.refreshAudioSession(),
  };
}

let bridge: CallKitBridge | null = null;

export function getCallKit(): CallKitBridge {
  if (bridge) return bridge;
  if (Platform.OS !== 'ios') {
    bridge = NOOP;
    return bridge;
  }
  const native = getNucoCallkit();
  bridge = native ? makeBridge(native) : NOOP;
  return bridge;
}
