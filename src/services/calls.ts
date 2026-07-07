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

import { createCallController, type CallController } from '@/calls/controller';
import { createNativeEngine } from '@/calls/engine';
import { createNativeCallAudio } from '@/calls/audio';
import type { CallRowInput } from '@/calls/types';
import { ensureConversation, getConversation } from '@/db/repos/conversations';
import { insertMessage } from '@/db/repos/messages';
import { setAutoLockDeferral, setPreLockHook } from '@/lock/lock-controller';
import { useCall } from '@/state/call';
import { emitConversationsChanged } from './data-events';
import { expiryFor, sendContent, setCallSignalHandler } from './messaging';
import { getRelay } from './relay';
import { getContactByHandle, isMutuallyVerified } from '@/db/repos/contacts';

let controller: CallController | null = null;

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
    onState: (snap) => useCall.getState().set(snap),
    newId: () => Crypto.randomUUID(),
    now: () => Date.now(),
    isRelayConnected: () => getRelay()?.isConnected() ?? false,
  });
  controller = instance;
  setCallSignalHandler((from, signal, sentAt) => instance.handleCallSignal(from, signal, sentAt));
  setAutoLockDeferral(() => instance.isInCall());
  setPreLockHook(() => instance.onAppLocking());
}

export function getCallController(): CallController {
  if (!controller) throw new Error('call service not initialized');
  return controller;
}
