// The call state machine. Pure TypeScript with injected dependencies (engine factory,
// audio, sealed signaling, TURN fetch, row writer), so it runs unchanged on Node for the
// machine check script and the server e2e harness. One controller instance owns at most
// one call at a time.
//
// Signaling rides the sealed Signal channel with at least once delivery, so every inbound
// frame can arrive late or twice. The defenses, in order: a stale offer (sender clock older
// than the staleness window) becomes a missed call and never rings; a small LRU of recently
// ended callIds swallows redeliveries; and every timeline row uses the callId as its row id
// so double writes are INSERT OR IGNORE no-ops.

import { CALL_RING_TIMEOUT_SECONDS, CALL_OFFER_STALE_SECONDS, callOfferWins } from '@nuco/protocol';

import {
  MicUnavailableError,
  NoRelayCandidatesError,
  type CallAudio,
  type CallAvailability,
  type CallContact,
  type CallEngine,
  type CallRowInput,
  type CallRowKind,
  type CallSignal,
  type CallStatus,
  type CallUiEndReason,
  type CallUiSnapshot,
  type IceState,
  type TurnCredentials,
} from './types';

export interface CallControllerDeps {
  createEngine: () => CallEngine;
  audio: CallAudio;
  sendSignal: (handle: string, signal: CallSignal) => Promise<void>;
  getTurnCredentials: () => Promise<TurnCredentials>;
  hasSession: (handle: string) => Promise<boolean>;
  writeCallRow: (row: CallRowInput) => Promise<void>;
  onState: (snap: CallUiSnapshot) => void;
  newId: () => string;
  now: () => number;
  isRelayConnected: () => boolean;
  ringTimeoutMs?: number; // default CALL_RING_TIMEOUT_SECONDS
  connectTimeoutMs?: number; // default 15s
  disconnectGraceMs?: number; // default 10s
  endedLingerMs?: number; // default 1.5s
  staleOfferMs?: number; // default CALL_OFFER_STALE_SECONDS
  signalTimeoutMs?: number; // default 10s
}

interface ActiveCall {
  callId: string;
  contact: CallContact;
  direction: 'in' | 'out';
  engine: CallEngine | null;
  pendingOfferSdp: string | null; // callee side: the remote offer awaiting answer()
  offerSendStarted: boolean; // caller side: the offer was handed to the transport (or is in flight)
  activeSince: number | null;
  muted: boolean;
  speaker: boolean;
}

// What the end-of-call screen shows while status is 'ending' (the live call is already
// torn down by then).
interface EndingView {
  contactId: string;
  contactName: string;
  direction: 'in' | 'out';
}

const RECENT_CALL_IDS_MAX = 20;

// Race a promise against a timeout without leaking an unhandled rejection from the loser.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error('failed'));
      },
    );
  });
}

export class CallController {
  private status: CallStatus = 'idle';
  private endReason: CallUiEndReason | null = null;
  private call: ActiveCall | null = null;
  private endingView: EndingView | null = null;
  private readonly recentlyEnded = new Set<string>();
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly ringTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly disconnectGraceMs: number;
  private readonly endedLingerMs: number;
  private readonly staleOfferMs: number;
  private readonly signalTimeoutMs: number;

  constructor(private readonly deps: CallControllerDeps) {
    this.ringTimeoutMs = deps.ringTimeoutMs ?? CALL_RING_TIMEOUT_SECONDS * 1000;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? 15_000;
    this.disconnectGraceMs = deps.disconnectGraceMs ?? 10_000;
    this.endedLingerMs = deps.endedLingerMs ?? 1_500;
    this.staleOfferMs = deps.staleOfferMs ?? CALL_OFFER_STALE_SECONDS * 1000;
    this.signalTimeoutMs = deps.signalTimeoutMs ?? 10_000;
  }

  getSnapshot(): CallUiSnapshot {
    const c = this.call;
    const ended = this.endingView;
    return {
      status: this.status,
      contactId: c?.contact.id ?? ended?.contactId ?? null,
      contactName: c?.contact.displayName ?? ended?.contactName ?? '',
      direction: c?.direction ?? ended?.direction ?? null,
      muted: c?.muted ?? false,
      speaker: c?.speaker ?? false,
      activeSince: c?.activeSince ?? null,
      endReason: this.endReason,
    };
  }

  isInCall(): boolean {
    return this.call !== null;
  }

  async checkAvailability(contact: { handle: string; blocked?: boolean }): Promise<CallAvailability> {
    if (this.call) return 'busy';
    if (contact.blocked) return 'blocked';
    if (!this.deps.isRelayConnected()) return 'offline';
    if (!(await this.deps.hasSession(contact.handle))) return 'no-session';
    return 'ok';
  }

  // Place an outgoing call. Returns the availability outcome; 'ok' means the attempt is
  // running (its progress and failures surface through the state snapshots).
  async placeCall(contact: CallContact): Promise<CallAvailability> {
    const availability = await this.checkAvailability(contact);
    if (availability !== 'ok') return availability;
    // An inbound offer can adopt the slot during the availability awaits; the ring wins,
    // never clobber it (its ringtone and the caller's pending offer would be orphaned).
    if (this.call) return 'busy';

    const call: ActiveCall = {
      callId: this.deps.newId(),
      contact,
      direction: 'out',
      engine: null,
      pendingOfferSdp: null,
      offerSendStarted: false,
      activeSince: null,
      muted: false,
      speaker: false,
    };
    this.call = call;
    this.clearLinger();
    this.setStatus('starting');

    let turn: TurnCredentials;
    try {
      turn = await this.deps.getTurnCredentials();
    } catch {
      if (this.call !== call) return 'ok';
      this.finish('no-turn', null);
      return 'ok';
    }
    if (this.call !== call) return 'ok';

    let sdp: string;
    try {
      const engine = this.deps.createEngine();
      call.engine = engine;
      await engine.start(turn, (s) => this.onIceState(call, s));
      sdp = await engine.createOfferSdp();
    } catch (err) {
      if (this.call !== call) return 'ok';
      if (err instanceof MicUnavailableError) this.finish('mic-failed', null);
      else if (err instanceof NoRelayCandidatesError) this.finish('no-turn', null);
      else this.finish('failed', null);
      return 'ok';
    }
    if (this.call !== call) return 'ok';

    call.offerSendStarted = true;
    try {
      await withTimeout(this.deps.sendSignal(contact.handle, { t: 'call/offer', callId: call.callId, sdp }), this.signalTimeoutMs);
    } catch {
      if (this.call !== call) return 'ok';
      // The offer may still be queued at the transport; a trailing end makes the outcome
      // unambiguous for the peer either way.
      this.sendEnd('hangup');
      this.finish('failed', null);
      return 'ok';
    }
    if (this.call !== call) return 'ok';

    this.setStatus('outgoing-ringing');
    this.ringTimer = setTimeout(() => {
      this.ringTimer = null;
      if (this.call !== call || this.status !== 'outgoing-ringing') return;
      this.sendEnd('timeout');
      this.finish('no-answer', this.rowFor('call/missed', null, false));
    }, this.ringTimeoutMs);
    return 'ok';
  }

  // Callee accepts the ringing call: fetch TURN, acquire the mic, answer.
  async answer(): Promise<void> {
    const call = this.call;
    if (!call || call.direction !== 'in' || this.status !== 'incoming-ringing') return;
    this.deps.audio.stopIncomingRing();
    this.clearRing();
    this.setStatus('connecting');

    let turn: TurnCredentials;
    try {
      turn = await this.deps.getTurnCredentials();
    } catch {
      if (this.call !== call) return;
      this.sendEnd('error');
      this.finish('no-turn', this.rowFor('call/missed', 'error', false));
      return;
    }
    if (this.call !== call) return;

    let answerSdp: string;
    try {
      const engine = this.deps.createEngine();
      call.engine = engine;
      await engine.start(turn, (s) => this.onIceState(call, s));
      answerSdp = await engine.acceptOfferSdp(call.pendingOfferSdp ?? '');
    } catch (err) {
      if (this.call !== call) return;
      this.sendEnd('error');
      if (err instanceof MicUnavailableError) this.finish('mic-failed', this.rowFor('call/missed', 'error', false));
      else if (err instanceof NoRelayCandidatesError) this.finish('no-turn', this.rowFor('call/missed', 'error', false));
      else this.finish('failed', this.rowFor('call/missed', 'error', false));
      return;
    }
    if (this.call !== call) return;

    try {
      await withTimeout(
        this.deps.sendSignal(call.contact.handle, { t: 'call/answer', callId: call.callId, sdp: answerSdp }),
        this.signalTimeoutMs,
      );
    } catch {
      if (this.call !== call) return;
      this.sendEnd('error');
      this.finish('failed', this.rowFor('call/missed', 'error', false));
      return;
    }
    if (this.call !== call) return;
    this.startConnectTimer(call);
  }

  decline(): void {
    const call = this.call;
    if (!call || this.status !== 'incoming-ringing') return;
    this.sendEnd('decline');
    this.finish('declined', this.rowFor('call/declined', null, false));
  }

  hangUp(): void {
    const call = this.call;
    if (!call) return;
    switch (this.status) {
      case 'starting':
        // If the offer was handed to the transport it may already be on its way (or queued
        // behind a reconnect): send the end marker so the peer never ghost rings. The
        // transport preserves order, so the end always follows the offer.
        if (call.offerSendStarted) {
          this.sendEnd('hangup');
          this.finish('canceled', this.rowFor('call/missed', 'canceled', false));
          return;
        }
        // Nothing signaled yet; the placeCall chain notices the aborted call.
        this.finish('canceled', null);
        return;
      case 'outgoing-ringing':
        this.sendEnd('hangup');
        this.finish('canceled', this.rowFor('call/missed', 'canceled', false));
        return;
      case 'incoming-ringing':
        this.decline();
        return;
      case 'connecting':
        this.sendEnd('hangup');
        this.finish(
          'canceled',
          call.direction === 'out' ? this.rowFor('call/missed', 'canceled', false) : this.rowFor('call/declined', null, false),
        );
        return;
      case 'active':
      case 'reconnecting':
        this.sendEnd('hangup');
        this.finish('ended', this.completedRow());
        return;
      default:
        return;
    }
  }

  setMuted(muted: boolean): void {
    const call = this.call;
    if (!call?.engine) return;
    call.engine.setMuted(muted);
    call.muted = muted;
    this.emit();
  }

  setSpeaker(on: boolean): void {
    const call = this.call;
    if (!call) return;
    this.deps.audio.setSpeaker(on);
    call.speaker = on;
    this.emit();
  }

  // Inbound signaling entry, called from the messaging receive pipeline (already decrypted,
  // deduped by envelope id at the relay, sender verified by the Signal session). Never
  // throws: a throw would leave the envelope unacked and redelivered forever.
  async handleCallSignal(from: CallContact, signal: CallSignal, sentAt: number): Promise<void> {
    try {
      switch (signal.t) {
        case 'call/offer':
          await this.handleOffer(from, signal.callId, signal.sdp, sentAt);
          return;
        case 'call/answer':
          this.handleAnswer(from, signal.callId, signal.sdp);
          return;
        case 'call/end':
          await this.handleEnd(from, signal.callId, signal.reason);
          return;
      }
    } catch {
      // Swallow: a broken signal must not wedge the receive chain.
    }
  }

  // Pre-lock hook: runs while the db key is still alive, so the end signal can be sealed
  // and the summary row written. Locking during a call always ends it.
  async onAppLocking(): Promise<void> {
    const call = this.call;
    if (!call) return;
    let signal: CallSignal | null = null;
    let row: CallRowInput | null = null;
    switch (this.status) {
      case 'starting':
        if (call.offerSendStarted) {
          signal = { t: 'call/end', callId: call.callId, reason: 'hangup' };
          row = this.rowFor('call/missed', 'canceled', false);
        }
        break;
      case 'outgoing-ringing':
        signal = { t: 'call/end', callId: call.callId, reason: 'hangup' };
        row = this.rowFor('call/missed', 'canceled', false);
        break;
      case 'incoming-ringing':
        signal = { t: 'call/end', callId: call.callId, reason: 'decline' };
        row = this.rowFor('call/declined', null, false);
        break;
      case 'connecting':
        signal = { t: 'call/end', callId: call.callId, reason: 'hangup' };
        row = call.direction === 'out' ? this.rowFor('call/missed', 'canceled', false) : this.rowFor('call/declined', null, false);
        break;
      case 'active':
      case 'reconnecting':
        signal = { t: 'call/end', callId: call.callId, reason: 'hangup' };
        row = this.completedRow();
        break;
      default:
        break;
    }
    if (signal) {
      try {
        // Bounded: the lock must never wait on a slow relay. A lost end signal is
        // recovered by the peer's own timers (ring timeout, ICE disconnect).
        await withTimeout(this.deps.sendSignal(call.contact.handle, signal), 2000);
      } catch {
        // Best effort only.
      }
    }
    if (row) {
      try {
        await this.deps.writeCallRow(row);
      } catch {
        // The db may already be closing.
      }
    }
    this.teardown(call);
    this.status = 'idle';
    this.endReason = null;
    this.endingView = null;
    this.emit();
  }

  // --- inbound signal handling ---

  private async handleOffer(from: CallContact, callId: string, sdp: string, sentAt: number): Promise<void> {
    if (this.recentlyEnded.has(callId)) return;
    const call = this.call;

    if (call) {
      const glareEligible =
        call.contact.handle === from.handle &&
        call.direction === 'out' &&
        (this.status === 'outgoing-ringing' || this.status === 'starting');
      if (glareEligible) {
        // Glare: both sides called each other (their offer can land while ours is still
        // being prepared or sent). The smaller callId wins on both sides.
        if (callOfferWins(call.callId, callId)) {
          this.remember(callId);
          return;
        }
        // We lose: silently abandon our offer (no signal, the peer derives the same
        // result) and answer theirs instead. Both users pressed call; do not ring. An
        // in flight placeCall chain aborts on the this.call generation check.
        this.clearTimers();
        try {
          call.engine?.close();
        } catch {
          // Engine teardown is best effort.
        }
        this.remember(call.callId);
        this.call = null;
        this.adoptIncoming(from, callId, sdp, { autoAnswer: true });
        return;
      }
      // Busy: another call is in progress. Auto decline; log the missed attempt only for
      // a third party (a crossed offer from the very contact we are already talking to is
      // glare residue or redelivery, and a missed row for it would be noise).
      this.remember(callId);
      void this.deps.sendSignal(from.handle, { t: 'call/end', callId, reason: 'busy' }).catch(() => undefined);
      if (call.contact.handle !== from.handle) {
        await this.writeRow({ callId, contactId: from.id, kind: 'call/missed', direction: 'in', body: null, unread: true });
      }
      return;
    }

    if (this.deps.now() - sentAt >= this.staleOfferMs) {
      // A queued offer redelivered after the ring window: missed call, no ring, no reply
      // (the caller has long timed out; its queued end marker dedupes against this row).
      this.remember(callId);
      await this.writeRow({ callId, contactId: from.id, kind: 'call/missed', direction: 'in', body: null, unread: true });
      return;
    }

    this.adoptIncoming(from, callId, sdp, { autoAnswer: false });
  }

  private adoptIncoming(from: CallContact, callId: string, sdp: string, opts: { autoAnswer: boolean }): void {
    const call: ActiveCall = {
      callId,
      contact: from,
      direction: 'in',
      engine: null,
      pendingOfferSdp: sdp,
      offerSendStarted: false,
      activeSince: null,
      muted: false,
      speaker: false,
    };
    this.call = call;
    this.clearLinger();
    this.setStatus('incoming-ringing');
    this.ringTimer = setTimeout(() => {
      this.ringTimer = null;
      if (this.call !== call || this.status !== 'incoming-ringing') return;
      // Backstop when the caller vanished without its end marker: stop ringing silently.
      this.finish('ended', this.rowFor('call/missed', null, true));
    }, this.ringTimeoutMs);
    if (opts.autoAnswer) {
      void this.answer();
    } else {
      this.deps.audio.startIncomingRing();
    }
  }

  private handleAnswer(from: CallContact, callId: string, sdp: string): void {
    const call = this.call;
    if (!call || call.direction !== 'out' || call.callId !== callId) return;
    if (call.contact.handle !== from.handle || this.status !== 'outgoing-ringing') return;
    this.clearRing();
    this.setStatus('connecting');
    this.startConnectTimer(call);
    call.engine?.acceptAnswerSdp(sdp).catch(() => {
      if (this.call !== call) return;
      this.sendEnd('error');
      this.finish('connection-lost', this.rowFor('call/missed', 'error', false));
    });
  }

  private async handleEnd(from: CallContact, callId: string, reason: string): Promise<void> {
    const call = this.call;
    if (call && call.callId === callId && call.contact.handle === from.handle) {
      switch (this.status) {
        case 'incoming-ringing':
          // The caller canceled or timed out: for this side it is a missed call.
          this.finish('ended', this.rowFor('call/missed', null, true));
          return;
        case 'outgoing-ringing':
          if (reason === 'decline') this.finish('declined', this.rowFor('call/declined', null, false));
          else if (reason === 'busy') this.finish('busy', this.rowFor('call/missed', 'busy', false));
          else this.finish('ended', this.rowFor('call/missed', null, false));
          return;
        case 'connecting':
          this.finish('ended', this.rowFor('call/missed', 'error', false));
          return;
        case 'active':
        case 'reconnecting':
          this.finish('ended', this.completedRow());
          return;
        default:
          return;
      }
    }
    // An end marker with no live call: a caller's queued timeout or cancel that arrived
    // after its offer was classified stale, or before it. Record the missed call once;
    // the row id (callId) dedupes against every other path.
    if (!this.recentlyEnded.has(callId)) {
      this.remember(callId);
      if (reason === 'hangup' || reason === 'timeout') {
        await this.writeRow({ callId, contactId: from.id, kind: 'call/missed', direction: 'in', body: null, unread: true });
      }
    }
  }

  // --- media state ---

  private onIceState(call: ActiveCall, s: IceState): void {
    if (this.call !== call) return;
    if (s === 'connected' || s === 'completed') {
      if (this.status === 'connecting') {
        this.clearConnect();
        call.activeSince = this.deps.now();
        this.deps.audio.startCallAudio();
        if (call.muted) call.engine?.setMuted(true);
        this.setStatus('active');
      } else if (this.status === 'reconnecting') {
        this.clearDisconnect();
        this.setStatus('active');
      }
      return;
    }
    if (s === 'disconnected') {
      if (this.status === 'active') {
        this.setStatus('reconnecting');
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (this.call !== call || this.status !== 'reconnecting') return;
          this.sendEnd('error');
          this.finish('connection-lost', this.completedRow());
        }, this.disconnectGraceMs);
      }
      return;
    }
    if (s === 'failed') {
      if (this.status === 'connecting') {
        this.sendEnd('error');
        this.finish('connection-lost', this.rowFor('call/missed', 'error', false));
      } else if (this.status === 'active' || this.status === 'reconnecting') {
        this.sendEnd('error');
        this.finish('connection-lost', this.completedRow());
      }
    }
  }

  private startConnectTimer(call: ActiveCall): void {
    this.clearConnect();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.call !== call || this.status !== 'connecting') return;
      this.sendEnd('error');
      this.finish('connection-lost', this.rowFor('call/missed', 'error', false));
    }, this.connectTimeoutMs);
  }

  // --- teardown and rows ---

  private rowFor(kind: CallRowKind, body: string | null, unread: boolean): CallRowInput {
    const call = this.call!;
    return { callId: call.callId, contactId: call.contact.id, kind, direction: call.direction, body, unread };
  }

  private completedRow(): CallRowInput {
    const call = this.call!;
    const seconds = call.activeSince ? Math.max(0, Math.round((this.deps.now() - call.activeSince) / 1000)) : 0;
    return this.rowFor(call.direction === 'out' ? 'call/outgoing' : 'call/incoming', String(seconds), false);
  }

  private async writeRow(row: CallRowInput): Promise<void> {
    try {
      await this.deps.writeCallRow(row);
    } catch {
      // The row writer already guards the db; never let it break signaling.
    }
  }

  private sendEnd(reason: 'hangup' | 'decline' | 'busy' | 'timeout' | 'error'): void {
    const call = this.call;
    if (!call) return;
    // Fire and forget: the transport queues while offline and flushes on reconnect.
    void this.deps.sendSignal(call.contact.handle, { t: 'call/end', callId: call.callId, reason }).catch(() => undefined);
  }

  private finish(reason: CallUiEndReason, row: CallRowInput | null): void {
    const call = this.call;
    if (!call) return;
    if (row) void this.writeRow(row);
    // Captured before teardown nulls the call, so the brief end state still shows who the
    // call was with.
    this.endingView = { contactId: call.contact.id, contactName: call.contact.displayName, direction: call.direction };
    this.teardown(call);
    this.endReason = reason;
    this.setStatus('ending');
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      if (this.status !== 'ending') return;
      this.endReason = null;
      this.endingView = null;
      this.setStatus('idle');
    }, this.endedLingerMs);
  }

  private teardown(call: ActiveCall): void {
    this.clearTimers();
    this.deps.audio.stopIncomingRing();
    this.deps.audio.stopCallAudio();
    try {
      call.engine?.close();
    } catch {
      // Engine teardown is best effort.
    }
    this.remember(call.callId);
    this.call = null;
  }

  private remember(callId: string): void {
    this.recentlyEnded.delete(callId);
    this.recentlyEnded.add(callId);
    if (this.recentlyEnded.size > RECENT_CALL_IDS_MAX) {
      const oldest = this.recentlyEnded.values().next().value;
      if (oldest !== undefined) this.recentlyEnded.delete(oldest);
    }
  }

  private clearRing(): void {
    if (this.ringTimer) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }
  private clearConnect(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
  private clearDisconnect(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }
  private clearLinger(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    // A new call replaces any lingering end state.
    this.endingView = null;
    if (this.status === 'ending') this.endReason = null;
  }
  private clearTimers(): void {
    this.clearRing();
    this.clearConnect();
    this.clearDisconnect();
  }

  private setStatus(next: CallStatus): void {
    this.status = next;
    this.emit();
  }

  private emit(): void {
    this.deps.onState(this.getSnapshot());
  }
}

export function createCallController(deps: CallControllerDeps): CallController {
  return new CallController(deps);
}
