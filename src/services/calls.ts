// Wires the pure call controller (src/calls/controller.ts) into the app: sealed signaling
// through the messaging service, TURN credentials from the relay singleton, timeline rows
// through the message repo, UI state into the call store, and the lock integration (defer
// the auto lock during a call, end the call gracefully before an explicit lock).
//
// Node safety: this module reaches react-native-webrtc and the audio session only through
// src/calls/engine.ts and src/calls/audio.ts, and nothing on a Node path (the crypto self
// test, the server e2e harness, the call machine check) imports this file. Keep it that
// way: Node entry points import the controller and fake engine directly.

import * as Crypto from 'expo-crypto';

import { getCallKit, type CallEndReport } from '@/calls/callkit';
import { createCallController, type CallController } from '@/calls/controller';
import { createNativeEngine } from '@/calls/engine';
import { createNativeCallAudio } from '@/calls/audio';
import type { CallRowInput, CallStatus, CallUiEndReason, CallUiSnapshot } from '@/calls/types';
import { ensureConversation, getConversation } from '@/db/repos/conversations';
import { insertMessage } from '@/db/repos/messages';
import { setAutoLockDeferral, setPreLockHook } from '@/lock/lock-controller';
import { useCall } from '@/state/call';
import { emitConversationsChanged } from './data-events';
import { expiryFor, sendContent, setCallSignalHandler } from './messaging';
import { getRelay } from './relay';
import { registerPush } from '@/transport/push';
import { getContactByHandle, isMutuallyVerified } from '@/db/repos/contacts';

let controller: CallController | null = null;

// --- CallKit mirroring ---
//
// The controller stays Node pure; everything CallKit is glued on here by watching the
// snapshot transitions. Exactly one call exists at a time (the controller enforces it,
// and the CXProvider is configured to match), so the mapping to CallKit is a single
// current uuid. A call reported natively from a VoIP push (locked phone, killed app)
// sits in the module's pending list until the sealed offer decrypts post unlock and the
// ring claims it; the wake guard below ends unclaimed ones as unanswered so the lock
// screen never rings forever on a call that expired at the relay.

const VOIP_CLAIM_WINDOW_MS = 60_000;

let callkitUuid: string | null = null;
let endedFromCallKit = false;
let answeredFromCallKit = false;
let prevStatus: CallStatus = 'idle';
const claimTimers = new Map<string, ReturnType<typeof setTimeout>>();

function mapEndReason(reason: CallUiEndReason | null): CallEndReport {
  switch (reason) {
    case 'no-answer':
    case 'canceled':
      return 'unanswered';
    case 'connection-lost':
    case 'no-turn':
    case 'mic-failed':
    case 'failed':
      return 'failed';
    default:
      return 'remoteEnded';
  }
}

function guardPendingCall(uuid: string, reportedAt: number): void {
  if (claimTimers.has(uuid)) return;
  const remaining = Math.max(1000, reportedAt + VOIP_CLAIM_WINDOW_MS - Date.now());
  claimTimers.set(
    uuid,
    setTimeout(() => {
      claimTimers.delete(uuid);
      const callkit = getCallKit();
      callkit.reportEnded(uuid, 'unanswered');
      callkit.consumePending(uuid);
    }, remaining),
  );
}

function clearClaimTimer(uuid: string): void {
  const timer = claimTimers.get(uuid);
  if (timer) clearTimeout(timer);
  claimTimers.delete(uuid);
}

// Runs pre unlock (from the root layout): a VoIP push may have launched a LOCKED app,
// and the natively reported call must not ring past the claim window even if the user
// never unlocks. Safe before unlock: touches only the CallKit bridge, never the db.
export function initCallKitWakeGuard(): void {
  const callkit = getCallKit();
  if (!callkit.available) return;
  for (const pending of callkit.pendingCalls()) {
    guardPendingCall(pending.uuid, pending.reportedAt);
  }
}

async function syncCallKit(snap: CallUiSnapshot): Promise<void> {
  const callkit = getCallKit();
  if (!callkit.available) return;
  const was = prevStatus;
  prevStatus = snap.status;
  if (snap.status === was) return;

  if (snap.status === 'incoming-ringing') {
    endedFromCallKit = false;
    answeredFromCallKit = false;
    // A VoIP wake already reported this call natively; claim the oldest pending one
    // instead of reporting a duplicate. The generic "Nuco" caller becomes the contact.
    const pending = callkit.pendingCalls()[0];
    if (pending) {
      clearClaimTimer(pending.uuid);
      callkit.consumePending(pending.uuid);
      callkitUuid = pending.uuid;
      callkit.updateCaller(pending.uuid, snap.contactName);
      if (pending.answered) {
        answeredFromCallKit = true;
        void controller?.answer();
      }
    } else {
      callkitUuid = await callkit.reportIncoming(snap.contactName);
    }
    return;
  }
  if (snap.status === 'starting' && snap.direction === 'out') {
    endedFromCallKit = false;
    answeredFromCallKit = false;
    callkitUuid = await callkit.startOutgoing(snap.contactName);
    return;
  }
  if (was === 'incoming-ringing' && (snap.status === 'connecting' || snap.status === 'active')) {
    // Accepted through the APP UI: route the answer through CallKit too, so the system
    // call banner flips to the active call instead of ringing on. performAnswerCallAction
    // fires again, but the controller's answer() is a no-op outside incoming-ringing.
    if (callkitUuid && !answeredFromCallKit) {
      void callkit.answerLocal(callkitUuid);
    }
    if (snap.status !== 'active') return;
  }
  if (snap.status === 'active' && snap.direction === 'out' && callkitUuid) {
    callkit.reportConnected(callkitUuid);
    return;
  }
  if (snap.status === 'ending' || snap.status === 'idle') {
    const uuid = callkitUuid;
    callkitUuid = null;
    if (uuid && !endedFromCallKit) {
      callkit.reportEnded(uuid, mapEndReason(snap.endReason));
    }
    endedFromCallKit = false;
  }
}

function initCallKit(instance: CallController): void {
  const callkit = getCallKit();
  if (!callkit.available) return;
  callkit.init({
    onAnswer: (uuid) => {
      if (uuid === callkitUuid) {
        answeredFromCallKit = true;
        void instance.answer();
      }
      // A pending (unclaimed) answer is remembered natively and honored at claim time.
    },
    onEnd: (uuid) => {
      clearClaimTimer(uuid);
      if (uuid === callkitUuid) {
        endedFromCallKit = true;
        instance.hangUp();
      }
    },
    onMuted: (uuid, muted) => {
      if (uuid === callkitUuid) instance.setMuted(muted);
    },
    onVoipToken: () => {
      // Re-register so the relay learns the fresh token (or its loss).
      void registerPush();
    },
    onVoipPush: (uuid) => {
      // The offer should follow over the socket; if it never decrypts (locked app the
      // user ignores, expired offer), the guard ends the native call as unanswered.
      for (const pending of callkit.pendingCalls()) {
        if (pending.uuid === uuid) guardPendingCall(pending.uuid, pending.reportedAt);
      }
    },
  });
  initCallKitWakeGuard();
}

// A summary row at a call's terminal transition. The row id is the callId, so INSERT OR
// IGNORE dedupes every double write path (both glare orderings, redelivered end markers).
// Retention applies exactly like any other message, anchored to the local clock.
async function writeCallRow(row: CallRowInput): Promise<void> {
  try {
    const now = Date.now();
    const convo =
      (await getConversation(row.contactId)) ?? (await ensureConversation(row.contactId, row.contactId, 86400, now));
    await insertMessage({
      id: row.callId,
      conversationId: row.contactId,
      direction: row.direction,
      kind: row.kind,
      body: row.body,
      status: row.direction === 'out' ? 'sent' : 'delivered',
      sentAt: now,
      expiresAt: expiryFor(convo.retentionSeconds, now),
      read: !row.unread,
    });
    emitConversationsChanged(row.contactId);
  } catch {
    // The db can be closing under a lock; a lost row must never break the call flow.
  }
}

// Idempotent. Called from wireRelayCallbacks in boot.ts, so the controller is registered
// before the relay can deliver the first envelope.
export function initCallService(): void {
  if (controller) return;
  const instance = createCallController({
    createEngine: createNativeEngine,
    audio: createNativeCallAudio(),
    sendSignal: async (handle, signal) => {
      await sendContent(handle, signal, Crypto.randomUUID());
    },
    getTurnCredentials: async () => {
      const relay = getRelay();
      if (!relay) throw new Error('relay not started');
      return relay.turnCredentials();
    },
    // Strictly stronger than a session check: a mutually verified contact always has a
    // session, and calling anyone else is gated exactly like messaging. The controller's
    // existing 'no-session' availability path carries the alert.
    hasSession: async (handle) => {
      const contact = await getContactByHandle(handle);
      return contact != null && isMutuallyVerified(contact);
    },
    writeCallRow,
    onState: (snap) => {
      useCall.getState().set(snap);
      void syncCallKit(snap);
    },
    newId: () => Crypto.randomUUID(),
    now: () => Date.now(),
    isRelayConnected: () => getRelay()?.isConnected() ?? false,
  });
  controller = instance;
  setCallSignalHandler((from, signal, sentAt) => instance.handleCallSignal(from, signal, sentAt));
  setAutoLockDeferral(() => instance.isInCall());
  setPreLockHook(() => instance.onAppLocking());
  initCallKit(instance);
}

export function getCallController(): CallController {
  if (!controller) throw new Error('call service not initialized');
  return controller;
}
