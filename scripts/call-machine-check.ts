// Call state machine check, runnable on Node with tsx. Two (or three) controllers are
// wired back to back through an in memory signal bus with fake engines, exercising the
// full transition table without a device: happy path, decline, caller timeout, busy,
// glare in both orderings, stale offers, redelivery, end before offer, failure modes,
// and the pre lock hook.
//
// Run: npx tsx scripts/call-machine-check.ts

import { createCallController, type CallController, type CallControllerDeps } from '../src/calls/controller';
import { createFakeEngine, noopAudio, type FakeEngineOptions } from '../src/calls/fake-engine';
import type { CallContact, CallRowInput, CallSignal, CallStatus, CallUiSnapshot, TurnCredentials } from '../src/calls/types';

let failures = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for condition'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Delivers signals between participants. auto mode delivers on the next tick; manual mode
// queues until flush(), which is how glare (both offers in flight at once) is staged.
class SignalBus {
  private participants = new Map<string, Participant>();
  private queue: Array<() => void> = [];
  auto = true;

  register(p: Participant): void {
    this.participants.set(p.contact.handle, p);
  }

  send(fromHandle: string, toHandle: string, signal: CallSignal): Promise<void> {
    const from = this.participants.get(fromHandle)!.contact;
    const target = this.participants.get(toHandle);
    const deliver = (): void => {
      if (target) void target.ctrl.handleCallSignal(from, signal, Date.now());
    };
    if (this.auto) setTimeout(deliver, 1);
    else this.queue.push(deliver);
    return Promise.resolve();
  }

  flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const deliver of q) deliver();
  }
}

interface Participant {
  ctrl: CallController;
  contact: CallContact;
  rows: CallRowInput[];
  history: CallUiSnapshot[];
  status(): CallStatus;
  everHad(status: CallStatus): boolean;
}

const TIMERS = {
  ringTimeoutMs: 80,
  connectTimeoutMs: 150,
  disconnectGraceMs: 60,
  endedLingerMs: 10,
  staleOfferMs: 400,
  signalTimeoutMs: 150,
} as const;

const TEST_TURN: TurnCredentials = { urls: ['turn:turn.test:3478'], username: 'u', credential: 'c', expiresAt: 0 };

function makeParticipant(
  bus: SignalBus,
  handle: string,
  overrides: Partial<CallControllerDeps> = {},
  engineOpts: FakeEngineOptions = {},
): Participant {
  const contact: CallContact = { id: handle, handle, displayName: handle };
  const rows: CallRowInput[] = [];
  const history: CallUiSnapshot[] = [];
  let idCounter = 0;
  const ctrl = createCallController({
    createEngine: () => createFakeEngine(engineOpts),
    audio: noopAudio,
    sendSignal: (to, signal) => bus.send(handle, to, signal),
    getTurnCredentials: async () => TEST_TURN,
    hasSession: async () => true,
    // Mimics the db: the row id is the callId and INSERT OR IGNORE dedupes.
    writeCallRow: async (row) => {
      if (!rows.some((r) => r.callId === row.callId)) rows.push(row);
    },
    onState: (s) => history.push(s),
    newId: () => `${handle}-call-${++idCounter}`,
    now: () => Date.now(),
    isRelayConnected: () => true,
    ...TIMERS,
    ...overrides,
  });
  const participant: Participant = {
    ctrl,
    contact,
    rows,
    history,
    status: () => ctrl.getSnapshot().status,
    everHad: (status) => history.some((s) => s.status === status),
  };
  bus.register(participant);
  return participant;
}

function freshPair(): { bus: SignalBus; a: Participant; b: Participant } {
  const bus = new SignalBus();
  return { bus, a: makeParticipant(bus, 'alice'), b: makeParticipant(bus, 'bob') };
}

async function main(): Promise<void> {
  console.log('call state machine check\n');

  // 1. Happy path: place, ring, answer, active both sides, hang up, summary rows.
  {
    const { a, b } = freshPair();
    check((await a.ctrl.placeCall(b.contact)) === 'ok', 'happy: placeCall accepted');
    await waitFor(() => b.status() === 'incoming-ringing');
    check(a.status() === 'outgoing-ringing', 'happy: caller is ringing');
    void b.ctrl.answer();
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    check(a.ctrl.getSnapshot().activeSince !== null, 'happy: duration anchor set');
    await sleep(20);
    a.ctrl.hangUp();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows.length === 1 && a.rows[0]!.kind === 'call/outgoing' && a.rows[0]!.direction === 'out', 'happy: caller wrote outgoing row');
    check(b.rows.length === 1 && b.rows[0]!.kind === 'call/incoming' && b.rows[0]!.direction === 'in', 'happy: callee wrote incoming row');
    check(/^\d+$/.test(a.rows[0]!.body ?? '') && /^\d+$/.test(b.rows[0]!.body ?? ''), 'happy: both rows carry a duration');
    check(!b.rows[0]!.unread, 'happy: a completed call is not unread');
  }

  // 1b. Accepted marker (protocol 2.5): the caller leaves ringing the moment the callee
  // presses answer, before the answer sdp exists; the later answer applies exactly once.
  {
    const { bus, a, b } = freshPair();
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    check(a.status() === 'outgoing-ringing', 'accept: caller ringing before the press');
    bus.auto = false; // hold signals so the accept and the answer are observable phases
    void b.ctrl.answer(); // queues call/accept synchronously, call/answer after engine work
    bus.flush(); // deliver only the accept
    await waitFor(() => a.status() === 'connecting');
    check(b.status() === 'connecting', 'accept: both sides connecting before the answer');
    await sleep(10); // let the fake engine finish producing the answer sdp
    bus.flush();
    bus.auto = true;
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    check(true, 'accept: answer after the accept still reaches active');
    await a.ctrl.handleCallSignal(b.contact, { t: 'call/answer', callId: 'alice-call-1', sdp: 'v=0 dup' }, Date.now());
    check(a.status() === 'active', 'accept: duplicate answer redelivery is ignored');
    a.ctrl.hangUp();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows[0]?.kind === 'call/outgoing', 'accept: caller summary row still correct');
  }

  // 1c. A stray accept with no live call is a silent no-op.
  {
    const { a, b } = freshPair();
    await a.ctrl.handleCallSignal(b.contact, { t: 'call/accept', callId: 'ghost-1' }, Date.now());
    check(a.status() === 'idle' && a.rows.length === 0, 'accept: stray accept with no call is a no-op');
  }

  // 2. Decline.
  {
    const { a, b } = freshPair();
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    b.ctrl.decline();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows[0]?.kind === 'call/declined' && a.rows[0].direction === 'out', 'decline: caller row is declined out');
    check(b.rows[0]?.kind === 'call/declined' && b.rows[0].direction === 'in' && !b.rows[0].unread, 'decline: callee row is declined in, read');
    check(a.history.some((s) => s.endReason === 'declined'), 'decline: caller saw the declined end state');
  }

  // 3. Caller ring timeout: missed rows on both sides, callee unread.
  {
    const { a, b } = freshPair();
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows[0]?.kind === 'call/missed' && a.rows[0].direction === 'out' && a.rows[0].body === null, 'timeout: caller missed row');
    check(b.rows[0]?.kind === 'call/missed' && b.rows[0].direction === 'in' && b.rows[0].unread, 'timeout: callee missed row is unread');
    check(a.history.some((s) => s.endReason === 'no-answer'), 'timeout: caller saw no-answer');
  }

  // 4. Busy: a third caller during an active ring is auto declined with busy.
  {
    const bus = new SignalBus();
    const a = makeParticipant(bus, 'alice');
    const b = makeParticipant(bus, 'bob');
    const c = makeParticipant(bus, 'carol');
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    void c.ctrl.placeCall(b.contact);
    // The attempt must first leave idle (placeCall awaits its availability checks before
    // the first transition), then come back to idle via the busy rejection.
    await waitFor(() => c.everHad('outgoing-ringing') && c.status() === 'idle');
    check(c.rows[0]?.kind === 'call/missed' && c.rows[0].body === 'busy' && c.rows[0].direction === 'out', 'busy: rejected caller sees busy');
    check(c.history.some((s) => s.endReason === 'busy'), 'busy: rejected caller saw the busy end state');
    check(b.rows.some((r) => r.contactId === 'carol' && r.kind === 'call/missed' && r.unread), 'busy: busy callee logged the missed attempt');
    check(b.status() === 'incoming-ringing', 'busy: original ring is undisturbed');
    b.ctrl.decline();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
  }

  // 5. Glare, both orderings: the smaller callId wins on both sides, the loser auto
  // answers, and exactly one call results.
  for (const aliceWins of [true, false]) {
    const bus = new SignalBus();
    // callIds are '<prefix>-call-1'; pick prefixes so the intended side wins.
    const a = makeParticipant(bus, 'alice', { newId: () => (aliceWins ? 'a-glare' : 'z-glare') });
    const b = makeParticipant(bus, 'bob', { newId: () => 'm-glare' });
    bus.auto = false;
    const placedA = a.ctrl.placeCall(b.contact);
    const placedB = b.ctrl.placeCall(a.contact);
    await Promise.all([placedA, placedB]);
    check(a.status() === 'outgoing-ringing' && b.status() === 'outgoing-ringing', `glare(${aliceWins ? 'a' : 'b'} wins): both offers in flight`);
    bus.auto = true;
    bus.flush();
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    const winner = aliceWins ? a : b;
    const loser = aliceWins ? b : a;
    check(winner.ctrl.getSnapshot().direction === 'out', 'glare: winner stays the caller');
    check(loser.ctrl.getSnapshot().direction === 'in', 'glare: loser becomes the callee');
    check(!loser.everHad('incoming-ringing') || loser.ctrl.getSnapshot().status === 'active', 'glare: no second ring for the loser');
    winner.ctrl.hangUp();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows.length === 1 && b.rows.length === 1, 'glare: exactly one row per side');
  }

  // 5b. Glare during the starting phase: an offer landing while the local attempt is
  // still fetching TURN resolves via the tiebreak instead of a spurious busy.
  {
    const bus = new SignalBus();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const a = makeParticipant(bus, 'alice', {
      newId: () => 'z-starting-glare',
      getTurnCredentials: async () => {
        await gate;
        return TEST_TURN;
      },
    });
    const b = makeParticipant(bus, 'bob', { newId: () => 'a-starting-glare' });
    void a.ctrl.placeCall(b.contact); // parked in 'starting' on the TURN gate
    await waitFor(() => a.status() === 'starting');
    void b.ctrl.placeCall(a.contact); // bob's offer lands while alice is still starting
    await waitFor(() => a.ctrl.getSnapshot().direction === 'in');
    release();
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    check(b.ctrl.getSnapshot().direction === 'out', 'starting-glare: winner keeps the call');
    check(!b.history.some((s) => s.endReason === 'busy'), 'starting-glare: no spurious busy');
    b.ctrl.hangUp();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows.length === 1 && b.rows.length === 1, 'starting-glare: one row per side');
  }

  // 5c. An inbound offer adopted while placeCall is still inside its availability checks
  // wins the slot; the outgoing attempt yields as busy and the ring survives.
  {
    const bus = new SignalBus();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const a = makeParticipant(bus, 'alice', {
      hasSession: async () => {
        await gate;
        return true;
      },
    });
    const b = makeParticipant(bus, 'bob');
    const placed = a.ctrl.placeCall(b.contact); // parked inside checkAvailability
    await a.ctrl.handleCallSignal(b.contact, { t: 'call/offer', callId: 'race-1', sdp: 'v=0 x' }, Date.now());
    check(a.status() === 'incoming-ringing', 'race: inbound offer adopted during availability check');
    release();
    check((await placed) === 'busy', 'race: outgoing attempt yields to the ring');
    check(a.status() === 'incoming-ringing', 'race: ring not clobbered');
    a.ctrl.decline();
    await waitFor(() => a.status() === 'idle');
  }

  // 6. Stale offer: never rings, logs an unread missed call.
  {
    const { a, b } = freshPair();
    const stale: CallSignal = { t: 'call/offer', callId: 'stale-1', sdp: 'v=0 old' };
    await b.ctrl.handleCallSignal(a.contact, stale, Date.now() - (TIMERS.staleOfferMs + 1000));
    check(b.status() === 'idle' && !b.everHad('incoming-ringing'), 'stale: no ring');
    check(b.rows[0]?.kind === 'call/missed' && b.rows[0].unread, 'stale: unread missed row');
    // The caller's queued end marker for the same call dedupes against that row.
    await b.ctrl.handleCallSignal(a.contact, { t: 'call/end', callId: 'stale-1', reason: 'timeout' }, Date.now());
    check(b.rows.length === 1, 'stale: trailing end marker dedupes');
  }

  // 7. Redelivered offer for an ended call is swallowed.
  {
    const { a, b } = freshPair();
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    b.ctrl.decline();
    await waitFor(() => b.status() === 'idle');
    const endedCallId = b.rows[0]!.callId;
    await b.ctrl.handleCallSignal(a.contact, { t: 'call/offer', callId: endedCallId, sdp: 'v=0 again' }, Date.now());
    check(b.status() === 'idle' && b.rows.length === 1, 'redelivery: offer for an ended call is ignored');
  }

  // 8. End before offer: the end marker logs the miss, the late offer never rings.
  {
    const { a, b } = freshPair();
    await b.ctrl.handleCallSignal(a.contact, { t: 'call/end', callId: 'ooo-1', reason: 'timeout' }, Date.now());
    check(b.rows[0]?.kind === 'call/missed' && b.rows[0].unread, 'ooo: end marker logged the missed call');
    await b.ctrl.handleCallSignal(a.contact, { t: 'call/offer', callId: 'ooo-1', sdp: 'v=0 late' }, Date.now());
    check(b.status() === 'idle' && b.rows.length === 1, 'ooo: late offer after its end never rings');
  }

  // 9. TURN fetch failure: fails fast, writes no row, signals nothing.
  {
    const bus = new SignalBus();
    const a = makeParticipant(bus, 'alice', {
      getTurnCredentials: async () => {
        throw new Error('CALLS_UNAVAILABLE');
      },
    });
    const b = makeParticipant(bus, 'bob');
    check((await a.ctrl.placeCall(b.contact)) === 'ok', 'no-turn: attempt starts');
    await waitFor(() => a.status() === 'idle');
    check(a.history.some((s) => s.endReason === 'no-turn'), 'no-turn: surfaced as no-turn');
    check(a.rows.length === 0, 'no-turn: no row for an unsignaled call');
    await sleep(30);
    check(b.status() === 'idle' && !b.everHad('incoming-ringing'), 'no-turn: peer never rang');
  }

  // 10. Mic failure on the caller side.
  {
    const bus = new SignalBus();
    const a = makeParticipant(bus, 'alice', {}, { failStart: 'mic' });
    const b = makeParticipant(bus, 'bob');
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => a.history.some((s) => s.endReason === 'mic-failed'));
    check(a.rows.length === 0, 'mic: no row for an unsignaled call');
    await sleep(30);
    check(!b.everHad('incoming-ringing'), 'mic: peer never rang');
  }

  // 11. ICE failure mid call ends with a duration row on the failing side and a completed
  // row on the peer (it receives the error end while active).
  {
    const bus = new SignalBus();
    const engineA = createFakeEngine();
    const a = makeParticipant(bus, 'alice', { createEngine: () => engineA });
    const b = makeParticipant(bus, 'bob');
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    void b.ctrl.answer();
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    engineA.simulateIce('failed');
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
    check(a.rows[0]?.kind === 'call/outgoing', 'ice-fail: failing side keeps the completed row');
    check(a.history.some((s) => s.endReason === 'connection-lost'), 'ice-fail: surfaced as connection lost');
    check(b.rows[0]?.kind === 'call/incoming', 'ice-fail: peer logs the completed call');
  }

  // 12. Disconnect grace: a brief drop reconnects without ending the call.
  {
    const bus = new SignalBus();
    const engineA = createFakeEngine();
    const a = makeParticipant(bus, 'alice', { createEngine: () => engineA });
    const b = makeParticipant(bus, 'bob');
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    void b.ctrl.answer();
    await waitFor(() => a.status() === 'active');
    engineA.simulateIce('disconnected');
    check(a.status() === 'reconnecting', 'grace: brief drop shows reconnecting');
    engineA.simulateIce('connected');
    check(a.status() === 'active', 'grace: recovers to active');
    a.ctrl.hangUp();
    await waitFor(() => a.status() === 'idle' && b.status() === 'idle');
  }

  // 13. Pre lock hook mid call: ends immediately (no linger), writes the row, tells the
  // peer.
  {
    const { a, b } = freshPair();
    void a.ctrl.placeCall(b.contact);
    await waitFor(() => b.status() === 'incoming-ringing');
    void b.ctrl.answer();
    await waitFor(() => a.status() === 'active' && b.status() === 'active');
    await a.ctrl.onAppLocking();
    check(a.status() === 'idle', 'lock: caller idle immediately after the hook');
    check(a.rows[0]?.kind === 'call/outgoing', 'lock: completed row written before the lock');
    await waitFor(() => b.status() === 'idle');
    check(b.rows[0]?.kind === 'call/incoming', 'lock: peer ended via the sealed end signal');
  }

  // 14. Availability guards.
  {
    const bus = new SignalBus();
    const offline = makeParticipant(bus, 'alice', { isRelayConnected: () => false });
    const noSession = makeParticipant(bus, 'carol', { hasSession: async () => false });
    const b = makeParticipant(bus, 'bob');
    check((await offline.ctrl.checkAvailability(b.contact)) === 'offline', 'guards: offline detected');
    check((await noSession.ctrl.checkAvailability(b.contact)) === 'no-session', 'guards: missing session detected');
    check((await b.ctrl.checkAvailability({ handle: 'x', blocked: true })) === 'blocked', 'guards: blocked contact detected');
    void b.ctrl.placeCall(offline.contact);
    await waitFor(() => b.status() !== 'idle');
    check((await b.ctrl.checkAvailability(offline.contact)) === 'busy', 'guards: busy while in a call');
    b.ctrl.hangUp();
    await waitFor(() => b.status() === 'idle');
  }

  if (failures > 0) {
    console.error(`\ncall machine check FAILED with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\ncall machine check OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
