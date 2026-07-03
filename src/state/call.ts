// Call state (UI only). A mirror of the controller's snapshot plus the mic soft ask
// prompt. Engine objects, SDP, and TURN credentials never enter this store.

import { create } from 'zustand';

import { IDLE_CALL_SNAPSHOT, type CallTarget, type CallUiSnapshot } from '@/calls/types';

// Set while the mic soft ask sheet should be visible for a pending outgoing call.
export interface MicPrompt {
  contact: CallTarget;
}

interface CallState extends CallUiSnapshot {
  micPrompt: MicPrompt | null;
  set: (snap: CallUiSnapshot) => void;
  setMicPrompt: (prompt: MicPrompt | null) => void;
}

export const useCall = create<CallState>((set) => ({
  ...IDLE_CALL_SNAPSHOT,
  micPrompt: null,
  set: (snap) => set(snap),
  setMicPrompt: (micPrompt) => set({ micPrompt }),
}));
