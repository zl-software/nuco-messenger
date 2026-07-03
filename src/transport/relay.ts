// The resilient relay client. It owns the single WebSocket to the relay and implements the
// protocol handshake, request and response correlation, heartbeat, exponential backoff
// reconnect, and an outbound queue. It is environment agnostic: the WebSocket constructor
// is injected, so the same code runs over Hermes global WebSocket in the app and over the
// ws package in the Node end to end harness.

import {
  PROTOCOL_VERSION,
  ErrorCode,
  type ProtocolVersion,
  type ServerMessage,
  type ClientMessage,
  type MessageEnvelope,
  type PreKeyBundle,
  type PreKeyUpload,
  type PushRegistration,
  type ErrorCodeValue,
} from '@nuco/protocol';

import { signChallenge, type AuthKeyPair } from '../crypto/identity';

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface RegisterParams {
  identityKey: string;
  authKey: string;
  registrationId: number;
  deviceId: number;
  push: PushRegistration;
}

export type RelayStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'connected';

// Short lived TURN credentials for a voice call, as issued by the relay (TURN REST
// scheme). Kept in memory only for the duration of a call, never persisted or logged.
export interface TurnCredentials {
  urls: readonly string[];
  username: string;
  credential: string;
  expiresAt: number; // unix seconds
}

export interface RelayClientOptions {
  url: string;
  handle: string;
  authKeyPair: AuthKeyPair;
  WebSocketImpl: WebSocketCtor;
  // Used to register this handle if the relay reports it is not registered (a brand new handle,
  // or a self hosted/reset relay that has never seen us). The client authenticates first and
  // only falls back to registering on a NotRegistered error, so an already registered device is
  // never rejected for trying to re-register before authenticating.
  registerOnConnect?: RegisterParams;
  onDeliver: (from: string, envelope: MessageEnvelope) => void | Promise<void>;
  onStatus?: (status: RelayStatus) => void;
  onError?: (code: ErrorCodeValue) => void;
  autoReconnect?: boolean;
  heartbeatMs?: number;
}

const HEARTBEAT_MS = 30000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30000;
const REQUEST_TIMEOUT_MS = 20000;

type PendingResolver = { resolve: (m: ServerMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type OutboundItem = { to: string; envelope: MessageEnvelope; resolve: () => void; reject: (e: Error) => void };

export class RelayClient {
  private ws: WebSocketLike | null = null;
  private status: RelayStatus = 'disconnected';
  private ridCounter = 0;
  private readonly pending = new Map<string, PendingResolver>();
  private readonly outbound: OutboundItem[] = [];
  private readyWaiters: Array<() => void> = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private registerParams?: RegisterParams;
  private pendingChallenge: string | null = null;
  private didTryRegister = false;
  // The relay's own version from the connected frame, used for minor feature negotiation
  // (a relay answers unknown frame TYPES with a rid-less MALFORMED_MESSAGE, never a typed
  // reply, so new frames must be gated on the advertised minor).
  private serverVersion: ProtocolVersion | null = null;

  constructor(private readonly opts: RelayClientOptions) {
    this.registerParams = opts.registerOnConnect;
  }

  start(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  stop(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.cancelReconnect();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  getStatus(): RelayStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  // Resolve once connected. With a timeoutMs it rejects instead of hanging forever, so callers
  // that must make progress (first run online) cannot wedge against an unreachable relay.
  ensureReady(timeoutMs?: number): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onReady = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      const timer = timeoutMs
        ? setTimeout(() => {
            const idx = this.readyWaiters.indexOf(onReady);
            if (idx >= 0) this.readyWaiters.splice(idx, 1);
            reject(new Error('relay ready timed out'));
          }, timeoutMs)
        : null;
      this.readyWaiters.push(onReady);
    });
  }

  // Resolve true once connected, or false after timeoutMs. Unlike ensureReady this never hangs,
  // so callers can wait briefly for an in progress connect without risking a permanent stall.
  waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.status === 'connected') return Promise.resolve(true);
    return new Promise((resolve) => {
      const onReady = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const idx = this.readyWaiters.indexOf(onReady);
        if (idx >= 0) this.readyWaiters.splice(idx, 1);
        resolve(false);
      }, timeoutMs);
      this.readyWaiters.push(onReady);
    });
  }

  async publishPreKeys(upload: PreKeyUpload): Promise<number> {
    await this.ensureReady();
    const reply = await this.request((rid) => ({ type: 'publishPreKeys', rid, preKeys: upload }));
    return reply.type === 'ok' ? Number(reply.data?.oneTimeCount ?? 0) : 0;
  }

  async fetchPreKeyBundle(handle: string): Promise<PreKeyBundle> {
    await this.ensureReady();
    const reply = await this.request((rid) => ({ type: 'fetchPreKeyBundle', rid, handle }));
    if (reply.type !== 'preKeyBundle') throw new Error('unexpected reply to fetchPreKeyBundle');
    return reply.bundle;
  }

  async preKeyCount(): Promise<{ hasSignedPreKey: boolean; oneTimeCount: number }> {
    await this.ensureReady();
    const reply = await this.request((rid) => ({ type: 'preKeyCount', rid }));
    if (reply.type !== 'preKeyCountResult') throw new Error('unexpected reply to preKeyCount');
    return { hasSignedPreKey: reply.hasSignedPreKey, oneTimeCount: reply.oneTimeCount };
  }

  // Update the device record (for example a new push token) on an authenticated socket.
  async updateRegistration(params: RegisterParams): Promise<void> {
    await this.ensureReady();
    await this.request((rid) => ({ type: 'register', rid, ...params }));
  }

  // Delete this account and all of its server side data. Bounded wait so account deletion can
  // proceed with the local wipe even if the relay is momentarily slow.
  async deregister(timeoutMs = 8000): Promise<void> {
    await this.ensureReady(timeoutMs);
    await this.request((rid) => ({ type: 'deregister', rid }));
  }

  // Fetch short lived TURN credentials for a voice call. Bounded wait so a call attempt
  // against a relay that just dropped fails fast instead of wedging the call screen.
  // Rejects with CALLS_UNAVAILABLE when the relay has no TURN configured or predates the
  // frame (a pre 1.3 relay would answer with a rid-less MALFORMED_MESSAGE and the request
  // would only die by timeout).
  async turnCredentials(timeoutMs = 8000): Promise<TurnCredentials> {
    await this.ensureReady(timeoutMs);
    if (this.serverVersion && this.serverVersion.minor < 3) {
      throw new Error(ErrorCode.CallsUnavailable);
    }
    const reply = await this.request((rid) => ({ type: 'turnCredentials', rid }));
    if (reply.type !== 'turnCredentialsResult') throw new Error('unexpected reply to turnCredentials');
    return { urls: reply.urls, username: reply.username, credential: reply.credential, expiresAt: reply.expiresAt };
  }

  // Hand a sealed envelope to the relay. Resolves when the relay accepts it; queued while
  // offline and flushed on reconnect.
  sendEnvelope(to: string, envelope: MessageEnvelope): Promise<void> {
    return new Promise((resolve, reject) => {
      this.outbound.push({ to, envelope, resolve, reject });
      if (this.status === 'connected') void this.flushOutbound();
    });
  }

  ack(id: string): void {
    if (this.status === 'connected') this.sendFrame({ type: 'ack', id });
  }

  // --- internals ---

  private setStatus(next: RelayStatus): void {
    this.status = next;
    this.opts.onStatus?.(next);
  }

  private openSocket(): void {
    // A pending reconnect is being fulfilled now (or superseded by an explicit open); drop its
    // timer so it cannot fire a second openSocket later and orphan this socket.
    this.cancelReconnect();
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    // The handle rides in the URL query (protocol 1.4) so an edge hosted relay can route
    // the socket to the right mailbox before the first frame. The connect frame still
    // carries it authoritatively.
    const sep = this.opts.url.includes('?') ? '&' : '?';
    const ws = new this.opts.WebSocketImpl(`${this.opts.url}${sep}handle=${encodeURIComponent(this.opts.handle)}`);
    this.ws = ws;
    ws.onopen = () => this.sendFrame({ type: 'connect', protocolVersion: PROTOCOL_VERSION, handle: this.opts.handle });
    ws.onmessage = (ev) => this.onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    ws.onclose = () => this.onClose();
    ws.onerror = () => this.ws?.close();
  }

  private sendFrame(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private nextRid(): string {
    this.ridCounter += 1;
    return `r${this.ridCounter}`;
  }

  private request(build: (rid: string) => ClientMessage): Promise<ServerMessage> {
    const rid = this.nextRid();
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('relay request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(rid, { resolve, reject, timer });
      this.sendFrame(build(rid));
    });
  }

  private settleRid(rid: string, settle: (p: PendingResolver) => void): void {
    const p = this.pending.get(rid);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(rid);
    settle(p);
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'connected':
        this.serverVersion = msg.protocolVersion;
        void this.onConnected(msg.challenge);
        return;
      case 'authenticated':
        this.onAuthenticated();
        return;
      case 'deliver':
        void this.opts.onDeliver(msg.from, msg.envelope);
        return;
      case 'ok':
      case 'preKeyBundle':
      case 'preKeyCountResult':
      case 'turnCredentialsResult': {
        const rid = msg.rid;
        this.settleRid(rid, (p) => p.resolve(msg));
        return;
      }
      case 'error':
        if (msg.rid) {
          this.settleRid(msg.rid, (p) => p.reject(new Error(msg.code)));
        } else if (msg.code === ErrorCode.NotRegistered && this.registerParams && !this.didTryRegister) {
          // Authentication said the relay does not know us yet: register, then retry auth.
          void this.registerThenAuthenticate();
          return;
        }
        this.opts.onError?.(msg.code);
        return;
      case 'pong':
        return;
    }
  }

  private onConnected(challenge: string): void {
    // Authenticate first. An already registered handle succeeds straight away; only if the relay
    // does not know us do we register and retry (see onMessage's NotRegistered handling).
    this.pendingChallenge = challenge;
    this.didTryRegister = false;
    this.sendAuthenticate();
  }

  private sendAuthenticate(): void {
    if (!this.pendingChallenge) return;
    this.sendFrame({
      type: 'authenticate',
      signature: signChallenge(this.opts.authKeyPair, this.pendingChallenge),
    });
  }

  // The relay does not know this handle (fresh handle, or a self hosted/reset relay). Register
  // it, then retry authentication with the same challenge.
  private async registerThenAuthenticate(): Promise<void> {
    if (!this.registerParams || this.didTryRegister) {
      this.ws?.close();
      return;
    }
    this.didTryRegister = true;
    try {
      await this.request((rid) => ({ type: 'register', rid, ...this.registerParams! }));
      this.sendAuthenticate();
    } catch {
      this.ws?.close();
    }
  }

  private onAuthenticated(): void {
    this.reconnectAttempts = 0;
    this.setStatus('connected');
    this.startHeartbeat();
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
    void this.flushOutbound();
  }

  private async flushOutbound(): Promise<void> {
    while (this.outbound.length > 0 && this.status === 'connected') {
      const item = this.outbound[0]!;
      try {
        await this.request((rid) => ({ type: 'send', rid, to: item.to, envelope: item.envelope }));
        this.outbound.shift();
        item.resolve();
      } catch (err) {
        // If the socket dropped, keep the item queued for the next ready and stop here.
        if (this.status !== 'connected') return;
        // Still connected: this item failed on its own (timeout or server error). Reject just
        // this one and keep draining, so a single bad send does not strand the rest of the queue.
        this.outbound.shift();
        item.reject(err instanceof Error ? err : new Error('send failed'));
      }
    }
  }

  private onClose(): void {
    this.stopHeartbeat();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('connection closed'));
    }
    this.pending.clear();
    this.ws = null;
    if (this.closedByUser || this.opts.autoReconnect === false) {
      this.setStatus('disconnected');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.reconnectAttempts);
    const jitter = base * 0.25 * Math.random();
    this.reconnectAttempts += 1;
    this.cancelReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.openSocket();
    }, base + jitter);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Constant payload (protocol 1.4): identical bytes every ping let the relay answer
      // from the edge without waking a hibernated mailbox.
      this.sendFrame({ type: 'ping', ts: 0 });
    }, this.opts.heartbeatMs ?? HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
