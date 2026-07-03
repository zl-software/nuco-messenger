// The ONLY file that imports react-native-webrtc (the same isolation rule as signal.ts for
// libsignal). Audio only, and relay only ICE: the peer connection never gathers host or
// server reflexive candidates, so the SDP we hand to signaling contains no local addresses
// and media always flows through the operator's TURN server.
//
// Security note: the SDP produced here carries the DTLS certificate fingerprint and rides
// the sealed Signal channel, so the DTLS-SRTP handshake is authenticated end to end by the
// messaging trust anchor. The TURN server only ever forwards SRTP ciphertext.

import { mediaDevices, MediaStream, RTCPeerConnection } from 'react-native-webrtc';

import {
  MicUnavailableError,
  NoRelayCandidatesError,
  type CallEngine,
  type IceState,
  type TurnCredentials,
} from './types';

// Relay only gathering is a single TURN allocation round trip; the cap only trips when the
// TURN server is unreachable, in which case the SDP would be useless anyway and the relay
// candidate check below turns it into a clean failure.
const GATHER_TIMEOUT_MS = 5000;

// react-native-webrtc's RTCPeerConnection is an event-target-shim EventTarget at runtime,
// but the shim's generic types do not resolve against the hoisted shim version, so the
// listener methods vanish from the type. Narrow structurally instead of loosening to any.
interface PeerConnectionEvents {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
const events = (target: RTCPeerConnection): PeerConnectionEvents => target as unknown as PeerConnectionEvents;

export function createNativeEngine(): CallEngine {
  let pc: RTCPeerConnection | null = null;
  let mic: MediaStream | null = null;
  // close() must be final even against an in flight start(): getUserMedia can resolve
  // after the controller has already torn the call down, and a stream assigned then would
  // hold the microphone open with nothing left to release it.
  let closed = false;

  const waitForGathering = (): Promise<void> =>
    new Promise((resolve) => {
      const target = pc;
      if (!target || target.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const done = (): void => {
        clearTimeout(timer);
        events(target).removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = (): void => {
        if (target.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(done, GATHER_TIMEOUT_MS);
      events(target).addEventListener('icegatheringstatechange', onChange);
    });

  // The local SDP after gathering. With iceTransportPolicy 'relay' every candidate line is
  // a relay candidate; none at all means the TURN allocation failed.
  const gatheredLocalSdp = (): string => {
    const sdp = pc?.localDescription?.sdp ?? '';
    if (!sdp.includes(' typ relay')) throw new NoRelayCandidatesError();
    return sdp;
  };

  return {
    async start(turn: TurnCredentials, onIceState: (s: IceState) => void): Promise<void> {
      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        throw new MicUnavailableError();
      }
      if (closed) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Track teardown is best effort.
          }
        }
        throw new Error('engine closed');
      }
      mic = stream;
      pc = new RTCPeerConnection({
        iceServers: [{ urls: [...turn.urls], username: turn.username, credential: turn.credential }],
        iceTransportPolicy: 'relay',
      });
      for (const track of mic.getTracks()) pc.addTrack(track, mic);
      const target = pc;
      events(target).addEventListener('iceconnectionstatechange', () => {
        onIceState(target.iceConnectionState as IceState);
      });
    },

    async createOfferSdp(): Promise<string> {
      if (!pc) throw new Error('engine not started');
      const offer = (await pc.createOffer({})) as { type: 'offer'; sdp: string };
      await pc.setLocalDescription(offer);
      await waitForGathering();
      return gatheredLocalSdp();
    },

    async acceptOfferSdp(offerSdp: string): Promise<string> {
      if (!pc) throw new Error('engine not started');
      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = (await pc.createAnswer()) as { type: 'answer'; sdp: string };
      await pc.setLocalDescription(answer);
      await waitForGathering();
      return gatheredLocalSdp();
    },

    async acceptAnswerSdp(answerSdp: string): Promise<void> {
      if (!pc) throw new Error('engine not started');
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    },

    setMuted(muted: boolean): void {
      for (const track of mic?.getAudioTracks() ?? []) track.enabled = !muted;
    },

    close(): void {
      closed = true;
      for (const track of mic?.getTracks() ?? []) {
        try {
          track.stop();
        } catch {
          // Track teardown is best effort.
        }
      }
      try {
        pc?.close();
      } catch {
        // Peer connection teardown is best effort.
      }
      pc = null;
      mic = null;
    },
  };
}
