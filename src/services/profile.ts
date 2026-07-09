// Display name changes. A rename updates the local account (the QR card rebuilds from the
// session account, so it shows the new name immediately), then announces the name to every
// mutually verified contact over the sealed channel (profile/name, since protocol 2.6).
// The per contact name_sync_pending flag makes the broadcast survive offline windows and
// app kills: it is set for everyone up front, cleared per contact only once the relay
// accepts the send (which means the recipient's mailbox queued it durably), and retried on
// every reconnect with whatever the CURRENT name is. Receivers treat an unchanged name as
// a no-op, so duplicate sends are harmless. Contacts blocked at rename time are never
// flagged; one unblocked later keeps the old name until the next rename.

import * as Crypto from 'expo-crypto';

import { loadAccount, setDisplayName } from './account';
import { sendContent } from './messaging';
import {
  listContacts,
  isMutuallyVerified,
  markAllNameSyncPending,
  setNameSyncPending,
  type Contact,
} from '@/db/repos/contacts';
import { isUnlocked } from '@/lock/lock-controller';
import { useSession } from '@/state/session';

export async function renameAccount(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const account = await loadAccount();
  if (!account || trimmed === account.displayName) return;
  await setDisplayName(trimmed);
  const updated = await loadAccount();
  if (updated) useSession.getState().setAccount(updated);
  await markAllNameSyncPending();
  void resendPendingNameSyncs();
}

// Send the current name to every contact whose copy is stale. Runs after a rename and on
// every relay connect. Fire and forget per contact: while the relay is unreachable the
// send sits in the transport's outbound queue and the promise stays pending, so the flag
// survives (and an app kill preserves it in the db for the next connect).
export async function resendPendingNameSyncs(): Promise<void> {
  if (!isUnlocked()) return;
  const account = await loadAccount();
  if (!account) return;
  let contacts: Contact[];
  try {
    contacts = await listContacts();
  } catch {
    return;
  }
  for (const c of contacts) {
    if (!c.nameSyncPending || c.blocked || !isMutuallyVerified(c)) continue;
    void sendContent(c.handle, { t: 'profile/name', name: account.displayName }, Crypto.randomUUID())
      .then(() => setNameSyncPending(c.id, false))
      .catch(() => undefined);
  }
}
