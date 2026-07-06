// Disappearing message enforcement. sweepExpired at boot alone is not enough: while the app
// stays open, expired messages must actually leave the database and the screen. A light timer
// deletes them on a short cadence and notifies the UI. It runs only while unlocked and is torn
// down on lock (the database is closed then).

import { sweepExpired } from '@/db/repos/messages';
import { emitConversationsChanged } from './data-events';
import { isUnlocked } from '@/lock/lock-controller';

// Short enough that a 1 minute custom timer (the shortest pickable) never lingers visibly
// past its expiry; the DELETE is indexed and cheap.
const SWEEP_INTERVAL_MS = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function sweepOnce(): Promise<void> {
  if (!isUnlocked()) return;
  try {
    if ((await sweepExpired(Date.now())) > 0) emitConversationsChanged();
  } catch {
    // The database can close under us (lock); the next unlock re-arms the sweeper.
  }
}

export function startExpirySweeper(): void {
  if (timer) return;
  // Sweep once immediately so anything already expired clears without waiting a full interval.
  void sweepOnce();
  timer = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS);
}

export function stopExpirySweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
