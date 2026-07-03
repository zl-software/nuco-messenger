// Shared call types. This module is pure (no React Native, no native modules) so the
// controller and its tests run on Node, mirroring how signal.ts isolates libsignal. All
// react-native-webrtc code stays behind engine.ts and all audio routing behind audio.ts;
// the rest of the app talks to these interfaces only.

import type { MessageContent } from '@nuco/protocol';

export type { TurnCredentials } from '../transport/relay';
import type { TurnCredentials } from '../transport/relay';

// The wire signaling variants, narrowed from the protocol content union so the controller
// compiles against the single source of truth.
export type CallSignal = Extract<MessageContent, { t: 'call/offer' | 'call/answer' | 'call/end' }>;

export interface CallContact {
  id: string;
  handle: string;
  displayName: string;
}

export type IceState = 'new' | 'checking' | 'connected' | 'completed' | 'disconnected' | 'failed' | 'closed';

// The native media boundary. One engine per call attempt; close() is final.
export interface CallEngine {
  // Acquire the microphone and build the peer connection (relay only ICE).
  start(turn: TurnCredentials, onIceState: (s: IceState) => void): Promise<void>;
  // Create the local offer and resolve with the complete SDP after ICE gathering.
  createOfferSdp(): Promise<string>;
  // Apply a remote offer and resolve with the complete local answer SDP.
  acceptOfferSdp(offerSdp: string): Promise<string>;
  // Apply the remote answer on the offering side.
  acceptAnswerSdp(answerSdp: string): Promise<void>;
  setMuted(muted: boolean): void;
  close(): void;
}

// Ring and in-call audio routing boundary (earpiece default, speaker toggle, ringtone).
export interface CallAudio {
  startIncomingRing(): void;
  stopIncomingRing(): void;
  startCallAudio(): void;
  stopCallAudio(): void;
  setSpeaker(on: boolean): void;
}

// Thrown by an engine when the microphone cannot be acquired (permission revoked mid
// flight, hardware in use). The controller maps it to the mic specific end reason.
export class MicUnavailableError extends Error {
  constructor(message = 'microphone unavailable') {
    super(message);
    this.name = 'MicUnavailableError';
  }
}

// Thrown by an engine when ICE gathering finished without a single relay candidate: the
// TURN server is unreachable or rejected us, so the SDP would be useless.
export class NoRelayCandidatesError extends Error {
  constructor(message = 'no relay candidates gathered') {
    super(message);
    this.name = 'NoRelayCandidatesError';
  }
}

export type CallStatus =
  | 'idle'
  | 'starting'
  | 'outgoing-ringing'
  | 'incoming-ringing'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'ending';

export type CallAvailability = 'ok' | 'busy' | 'blocked' | 'no-session' | 'offline';

// Why the call ended, for the brief end state on the call screen. UI level only; the wire
// reasons live in the protocol content union.
export type CallUiEndReason =
  | 'ended'
  | 'declined'
  | 'busy'
  | 'no-answer'
  | 'canceled'
  | 'connection-lost'
  | 'no-turn'
  | 'mic-failed'
  | 'failed';

// The UI facing snapshot pushed into the zustand store on every transition. Holds no
// engine objects and no key material.
export interface CallUiSnapshot {
  status: CallStatus;
  contactId: string | null;
  contactName: string;
  direction: 'in' | 'out' | null;
  muted: boolean;
  speaker: boolean;
  activeSince: number | null; // epoch ms when media connected; drives the duration timer
  endReason: CallUiEndReason | null; // set while status is 'ending'
}

export const IDLE_CALL_SNAPSHOT: CallUiSnapshot = {
  status: 'idle',
  contactId: null,
  contactName: '',
  direction: null,
  muted: false,
  speaker: false,
  activeSince: null,
  endReason: null,
};

export type CallRowKind = 'call/outgoing' | 'call/incoming' | 'call/missed' | 'call/declined';

// A timeline row written at a terminal transition. The row id is the callId so INSERT OR
// IGNORE dedupes every redelivery and double-write path. direction is the call direction
// (who initiated), body carries duration seconds as a string for completed calls, or a
// marker token ('busy' | 'canceled' | 'error') or null for the others.
export interface CallRowInput {
  callId: string;
  contactId: string;
  kind: CallRowKind;
  direction: 'in' | 'out';
  body: string | null;
  unread: boolean;
}
