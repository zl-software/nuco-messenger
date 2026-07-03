// A pure fake of the media boundary for Node tests (the machine check script and the
// server e2e harness). No WebRTC: it hands out dummy SDP and fires ICE transitions on a
// short timer, with switchable failure modes.

import {
  MicUnavailableError,
  NoRelayCandidatesError,
  type CallAudio,
  type CallEngine,
  type IceState,
} from './types';

export interface FakeEngineOptions {
  failStart?: 'mic' | 'error';
  failOffer?: 'no-relay' | 'error';
  // When false the engine never connects on its own; drive it with simulateIce.
  autoConnect?: boolean;
  connectDelayMs?: number;
}

export interface FakeEngine extends CallEngine {
  simulateIce(state: IceState): void;
  isClosed(): boolean;
}

export function createFakeEngine(opts: FakeEngineOptions = {}): FakeEngine {
  let onIce: ((s: IceState) => void) | null = null;
  let closed = false;
  const fire = (s: IceState): void => {
    if (!closed) onIce?.(s);
  };
  const scheduleConnect = (): void => {
    if (opts.autoConnect === false) return;
    setTimeout(() => fire('connected'), opts.connectDelayMs ?? 5);
  };
  return {
    async start(_turn, onIceState) {
      if (opts.failStart === 'mic') throw new MicUnavailableError();
      if (opts.failStart === 'error') throw new Error('fake engine start failed');
      onIce = onIceState;
    },
    async createOfferSdp() {
      if (opts.failOffer === 'no-relay') throw new NoRelayCandidatesError();
      if (opts.failOffer === 'error') throw new Error('fake offer failed');
      return 'v=0 fake-offer';
    },
    async acceptOfferSdp(_offerSdp) {
      scheduleConnect();
      return 'v=0 fake-answer';
    },
    async acceptAnswerSdp(_answerSdp) {
      scheduleConnect();
    },
    setMuted() {
      // Nothing to mute.
    },
    close() {
      closed = true;
    },
    simulateIce(s) {
      fire(s);
    },
    isClosed() {
      return closed;
    },
  };
}

export const noopAudio: CallAudio = {
  startIncomingRing() {},
  stopIncomingRing() {},
  startCallAudio() {},
  stopCallAudio() {},
  setSpeaker() {},
};
