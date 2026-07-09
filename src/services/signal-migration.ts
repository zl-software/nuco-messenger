// The break clean migration to native libsignal (PQXDH, protocol 3.0). The retired JS
// port persisted sessions and keys as JSON records that libsignal cannot read, and the
// PQXDH cut regenerates identities anyway, so a pre swap install gets its Signal state
// wiped and a fresh identity: the handle and the transport auth key survive (the relay
// registration stays valid), every contact drops back to unverified, and each existing
// conversation gets one system note telling the pair to re-scan. Runs from bringOnline
// BEFORE the relay is wired, so no envelope can race the wipe; envelopes still queued at
// the relay were sealed to the dead identity, fail decrypt, stay unacked, and expire at
// the queue TTL.

import * as Crypto from 'expo-crypto';

import {
  generateIdentity,
  generateSignedPreKey,
  generateKyberPreKey,
  installIdentity,
  toSignedPreKeyPublic,
  toKyberPreKeyPublic,
  identityPublicKeyBase64,
  NucoSignalStore,
  STORE_FORMAT_NATIVE,
  SIGNED_PREKEY_ID,
  KYBER_PREKEY_ID,
} from '@/crypto';
import { nativeBackend } from '@/crypto/backend-native';
import { SqliteSignalBackend } from '@/db/signal-backend';
import { getMetaJson, setMetaJson } from '@/db/repos/meta';
import { listContacts, resetAllVerification } from '@/db/repos/contacts';
import { getConversation } from '@/db/repos/conversations';
import { insertMessage } from '@/db/repos/messages';
import { resetSignal, type StoredAccount } from './account';
import { emitConversationsChanged } from './data-events';
import { expiryFor } from './messaging';

// Returns true when a pre swap store was found and migrated. Call with the encrypted
// database open, before loadAccount and before the relay starts.
export async function migrateSignalStateIfNeeded(): Promise<boolean> {
  const stored = await getMetaJson<StoredAccount>('account');
  if (!stored) return false; // fresh install; onboarding provisions natively
  const store = new NucoSignalStore(new SqliteSignalBackend());
  if ((await store.getStoreFormat()) === STORE_FORMAT_NATIVE) return false;

  // Wipe the JS port's records and regenerate the whole Signal identity.
  await store.wipeAll();
  const backend = nativeBackend();
  const id = await generateIdentity(backend);
  const signedPreKey = await generateSignedPreKey(backend, id.identityKeyPair.privateKey, SIGNED_PREKEY_ID);
  const kyberPreKey = await generateKyberPreKey(backend, id.identityKeyPair.privateKey, KYBER_PREKEY_ID);
  await installIdentity(store, id, signedPreKey, kyberPreKey, stored.handle);
  resetSignal();

  // The account keeps its handle, display name, and transport auth key; the Signal
  // identity and both prekeys are new.
  const rewritten: StoredAccount = {
    handle: stored.handle,
    displayName: stored.displayName,
    identityKeyB64: identityPublicKeyBase64(id),
    registrationId: id.registrationId,
    signedPreKey: toSignedPreKeyPublic(signedPreKey),
    kyberPreKey: toKyberPreKeyPublic(kyberPreKey),
    authPub: stored.authPub,
    authSecret: stored.authSecret,
  };
  await setMetaJson('account', rewritten);

  // Every confirm bound the dead identity: verification restarts from zero, and each
  // existing conversation gets one unread note (the unread badge surfaces it).
  await resetAllVerification();
  const now = Date.now();
  for (const contact of await listContacts()) {
    const convo = await getConversation(contact.id);
    if (!convo) continue;
    await insertMessage({
      id: Crypto.randomUUID(),
      conversationId: convo.id,
      direction: 'out',
      kind: 'security/upgrade',
      body: null,
      status: 'sent',
      sentAt: now,
      expiresAt: expiryFor(convo.retentionSeconds, now),
      read: false,
    });
  }
  emitConversationsChanged();
  return true;
}
