// Session state (UI only). Holds the loaded account, the lock status mirror, and the relay
// status. Key material is never stored here, only in the crypto and lock modules.

import { create } from 'zustand';

import type { Account } from '@/services/account';
import type { LockStatus } from '@/lock/lock-controller';
import type { RelayStatus } from '@/transport/relay';

interface SessionState {
  account: Account | null;
  lockStatus: LockStatus;
  relayStatus: RelayStatus;
  // Set when the relay refused to create our handle (attestation gating); cleared on the
  // next connection attempt. Drives the registration blocked banner on the chats screen.
  registrationError: 'ATTESTATION_REQUIRED' | 'ATTESTATION_FAILED' | null;
  setAccount: (account: Account | null) => void;
  setLockStatus: (status: LockStatus) => void;
  setRelayStatus: (status: RelayStatus) => void;
  setRegistrationError: (error: SessionState['registrationError']) => void;
}

export const useSession = create<SessionState>((set) => ({
  account: null,
  lockStatus: 'locked',
  relayStatus: 'disconnected',
  registrationError: null,
  setAccount: (account) => set({ account }),
  setLockStatus: (lockStatus) => set({ lockStatus }),
  setRelayStatus: (relayStatus) => set({ relayStatus }),
  setRegistrationError: (registrationError) => set({ registrationError }),
}));
