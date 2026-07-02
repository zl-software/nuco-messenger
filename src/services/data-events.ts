// Change notifications from the data layer writers to screens. Same pattern as the lock
// controller: a Set of listeners, subscribe returns unsubscribe. The payload is the
// conversation id when the change is scoped to one conversation, undefined when anything
// may have changed.
//
// Convention: repos never emit; any service that writes messages or conversation state
// must emit after the write. Listeners must not assume the db is still open.

type ConversationsListener = (conversationId?: string) => void;

const listeners = new Set<ConversationsListener>();

export function subscribeConversationsChanged(fn: ConversationsListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitConversationsChanged(conversationId?: string): void {
  for (const fn of listeners) {
    try {
      fn(conversationId);
    } catch {
      // A listener must never break a write path (e.g. prevent the relay ack).
    }
  }
}
