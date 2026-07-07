// The per chat lock: key custody, the in memory registry of released chat keys, and the
// enable/disable orchestration. Mirrors the app lock design (lock-controller.ts, pin.ts):
// the chat CODE is mandatory and wraps the chat's X25519 private key (scrypt + AES-GCM via
// crypto/chat-lock.ts); biometrics are an optional convenience copy behind the OS prompt
// (requireAuthentication), so a biometric re-enrollment can never brick a chat. Released
// private keys live only in this module's memory: leaving the chat screen relocks that
// chat, and an app lock clears everything (wired via subscribeLock, so lock-controller.ts
// itself stays untouched and auditable in one file).
//
// SecureStore has no enumeration, so an index item tracks which conversations hold lock
// items; wipe paths (account delete, dev reset, reinstall guard) and contact deletion walk
// it. The index holds only random conversation ids, never content or keys.

import * as SecureStore from 'expo-secure-store';

import { base64ToBytes as fromB64, bytesToBase64 as toB64 } from '@/crypto/bytes';
import {
  generateChatLockKeys,
  isSealed,
  openBody,
  sealBody,
  unwrapChatKeyWithCode,
  wrapChatKeyWithCode,
} from '@/crypto/chat-lock';
import { subscribeLock } from './lock-controller';
import {
  getConversation,
  listLockedConversations,
  setChatLock,
  setChatLockAttempts,
  setChatLockBio,
} from '@/db/repos/conversations';
import {
  deleteConversationMessages,
  listSealablePlaintext,
  listSealedRows,
  updateMessageBody,
  type Message,
} from '@/db/repos/messages';

const ITEM_PREFIX = 'nuco.chatlock.';
const INDEX_KEY = 'nuco.chatlock.index';

export const CHAT_LOCK_MAX_ATTEMPTS = 5;
export const CHAT_LOCK_LOCKOUT_MS = 5 * 60_000;

const SEAL_BATCH = 50;

const DEVICE_BOUND = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
} as const;

function bioKeyFor(conversationId: string): string {
  return `${ITEM_PREFIX}${conversationId}.bio`;
}
function codeKeyFor(conversationId: string): string {
  return `${ITEM_PREFIX}${conversationId}.code`;
}

// conversationId -> released private key. JavaScript cannot truly zero memory; dropping
// the reference on relock is the best available, the durable protection is the keystore.
const releasedKeys = new Map<string, Uint8Array>();
// conversationId -> messageId -> plaintext. The chat screen polls, so opened bodies are
// cached per unlocked chat and dropped together with the key on relock.
const bodyCache = new Map<string, Map<string, string>>();

let initialized = false;
export function initChatLocks(): void {
  if (initialized) return;
  initialized = true;
  subscribeLock((s) => {
    if (s === 'locked') clearAllReleased();
  });
}

function clearAllReleased(): void {
  releasedKeys.clear();
  bodyCache.clear();
}

export function isChatUnlocked(conversationId: string): boolean {
  return releasedKeys.has(conversationId);
}

export function relockChat(conversationId: string): void {
  releasedKeys.delete(conversationId);
  bodyCache.delete(conversationId);
}

// ---- keystore index ----

async function readIndex(): Promise<string[]> {
  const json = await SecureStore.getItemAsync(INDEX_KEY, DEVICE_BOUND);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  if (ids.length === 0) await SecureStore.deleteItemAsync(INDEX_KEY, DEVICE_BOUND);
  else await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids), DEVICE_BOUND);
}

async function addToIndex(conversationId: string): Promise<void> {
  const ids = await readIndex();
  if (!ids.includes(conversationId)) await writeIndex([...ids, conversationId]);
}

async function removeFromIndex(conversationId: string): Promise<void> {
  const ids = await readIndex();
  if (ids.includes(conversationId)) await writeIndex(ids.filter((id) => id !== conversationId));
}

// Removes one conversation's lock items (contact deletion; also part of disable).
export async function removeChatLockSecrets(conversationId: string): Promise<void> {
  await SecureStore.deleteItemAsync(bioKeyFor(conversationId), DEVICE_BOUND);
  await SecureStore.deleteItemAsync(codeKeyFor(conversationId), DEVICE_BOUND);
  await removeFromIndex(conversationId);
  relockChat(conversationId);
}

// Removes every per chat lock item (account delete, dev reset, reinstall guard). Walks the
// index because SecureStore cannot enumerate.
export async function wipeAllChatLockSecrets(): Promise<void> {
  const ids = await readIndex();
  for (const id of ids) {
    await SecureStore.deleteItemAsync(bioKeyFor(id), DEVICE_BOUND);
    await SecureStore.deleteItemAsync(codeKeyFor(id), DEVICE_BOUND);
  }
  await SecureStore.deleteItemAsync(INDEX_KEY, DEVICE_BOUND);
  clearAllReleased();
}

// ---- enable / disable / key management ----

// Turn the lock on: keys first, flags second, history pass last. Flag order matters: once
// lock_pubkey is set the receive path seals concurrent inbound, and the history pass is
// idempotent (meta IS NULL predicate), so a crash mid pass self heals via
// sealPendingForLockedChats at the next boot.
export async function enableChatLock(conversationId: string, code: string, bioOn: boolean): Promise<void> {
  const keys = generateChatLockKeys();
  await SecureStore.setItemAsync(codeKeyFor(conversationId), await wrapChatKeyWithCode(keys.privKey, code), DEVICE_BOUND);
  if (bioOn) {
    await SecureStore.setItemAsync(bioKeyFor(conversationId), toB64(keys.privKey), {
      ...DEVICE_BOUND,
      requireAuthentication: true,
    });
  }
  await addToIndex(conversationId);
  await setChatLock(conversationId, { enabled: true, bioEnabled: bioOn, pubkey: keys.pubKeyB64 });
  releasedKeys.set(conversationId, keys.privKey);
  await sealHistory(conversationId, keys.pubKeyB64);
}

// Turn the lock off. Requires the chat unlocked (the private key must be in the registry).
// The history is decrypted back BEFORE the flags flip; a crash mid pass leaves the chat
// still locked with some rows already plaintext, which renders fine (meta NULL = as-is).
export async function disableChatLock(conversationId: string): Promise<void> {
  const priv = releasedKeys.get(conversationId);
  const convo = await getConversation(conversationId);
  if (!priv || !convo?.lockPubkey) throw new Error('chat not unlocked');
  await unsealHistory(conversationId, priv, convo.lockPubkey);
  await setChatLock(conversationId, { enabled: false, bioEnabled: false, pubkey: null });
  await removeChatLockSecrets(conversationId);
}

// The forgot-code exit when no biometric copy can release the key: the sealed bodies are
// unrecoverable by design, so the only way out is deleting them. Removes every message
// row of the conversation, then the lock and its keystore items.
export async function removeLockAndDeleteMessages(conversationId: string): Promise<void> {
  await deleteConversationMessages(conversationId);
  await setChatLock(conversationId, { enabled: false, bioEnabled: false, pubkey: null });
  await removeChatLockSecrets(conversationId);
}

// Re-wrap the private key under a new code. No history re-encryption needed (the content
// keys derive from the X25519 pair, not from the code).
export async function changeChatCode(conversationId: string, newCode: string): Promise<void> {
  const priv = releasedKeys.get(conversationId);
  if (!priv) throw new Error('chat not unlocked');
  await SecureStore.setItemAsync(codeKeyFor(conversationId), await wrapChatKeyWithCode(priv, newCode), DEVICE_BOUND);
}

export async function setChatBio(conversationId: string, on: boolean): Promise<void> {
  if (on) {
    const priv = releasedKeys.get(conversationId);
    if (!priv) throw new Error('chat not unlocked');
    await SecureStore.setItemAsync(bioKeyFor(conversationId), toB64(priv), {
      ...DEVICE_BOUND,
      requireAuthentication: true,
    });
  } else {
    await SecureStore.deleteItemAsync(bioKeyFor(conversationId), DEVICE_BOUND);
  }
  await setChatLockBio(conversationId, on);
}

// ---- unlock ----

export async function unlockChatWithBiometrics(conversationId: string, prompt: string): Promise<boolean> {
  try {
    const b64 = await SecureStore.getItemAsync(bioKeyFor(conversationId), {
      ...DEVICE_BOUND,
      requireAuthentication: true,
      authenticationPrompt: prompt,
    });
    if (!b64) return false;
    releasedKeys.set(conversationId, fromB64(b64));
    return true;
  } catch {
    // Canceled prompt or an invalidated biometric set; the mandatory code path remains.
    return false;
  }
}

// Throws never; returns false on a wrong code and maintains the persisted per chat
// lockout (survives force quit, wipes with the conversation).
export async function unlockChatWithCode(conversationId: string, code: string): Promise<boolean> {
  const convo = await getConversation(conversationId);
  if (!convo) return false;
  if (convo.lockLockoutUntil > Date.now()) return false;
  const wrappedJson = await SecureStore.getItemAsync(codeKeyFor(conversationId), DEVICE_BOUND);
  if (!wrappedJson) return false;
  try {
    const priv = await unwrapChatKeyWithCode(wrappedJson, code);
    releasedKeys.set(conversationId, priv);
    await setChatLockAttempts(conversationId, 0, 0);
    return true;
  } catch {
    const attempts = convo.lockFailedAttempts + 1;
    if (attempts >= CHAT_LOCK_MAX_ATTEMPTS) {
      await setChatLockAttempts(conversationId, 0, Date.now() + CHAT_LOCK_LOCKOUT_MS);
    } else {
      await setChatLockAttempts(conversationId, attempts, 0);
    }
    return false;
  }
}

// ---- body access ----

// Open one sealed body with the released key. Throws when the chat is not unlocked or the
// row fails authentication.
export function openWithReleasedKey(
  conversationId: string,
  lockPubkey: string,
  messageId: string,
  bodyB64: string,
  meta: string,
): string {
  const priv = releasedKeys.get(conversationId);
  if (!priv) throw new Error('chat locked');
  return openBody(bodyB64, meta, priv, lockPubkey, conversationId, messageId);
}

// Body for display. Plaintext rows pass through; sealed rows decrypt via the released key
// with a per chat cache (the chat screen polls). Throws when the chat is not unlocked or
// the row fails authentication; callers render a localized placeholder then.
export function decryptBodyCached(conversationId: string, lockPubkey: string, message: Message): string | null {
  if (message.body == null) return null;
  if (!isSealed(message.meta ?? null)) return message.body;
  const cached = bodyCache.get(conversationId)?.get(message.id);
  if (cached !== undefined) return cached;
  const plain = openWithReleasedKey(conversationId, lockPubkey, message.id, message.body, message.meta!);
  let cache = bodyCache.get(conversationId);
  if (!cache) {
    cache = new Map();
    bodyCache.set(conversationId, cache);
  }
  cache.set(message.id, plain);
  return plain;
}

// ---- history passes ----

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Seal every plaintext text row of the conversation, in yielding batches. Idempotent and
// resumable: only rows with NULL meta are touched.
export async function sealHistory(conversationId: string, pubkeyB64: string): Promise<void> {
  for (;;) {
    const batch = await listSealablePlaintext(conversationId, SEAL_BATCH);
    if (batch.length === 0) return;
    for (const m of batch) {
      if (m.body == null) continue;
      const sealed = sealBody(m.body, pubkeyB64, conversationId, m.id);
      await updateMessageBody(m.id, sealed.bodyB64, sealed.meta);
    }
    await yieldToUi();
  }
}

async function unsealHistory(conversationId: string, priv: Uint8Array, pubkeyB64: string): Promise<void> {
  for (;;) {
    const batch = await listSealedRows(conversationId, SEAL_BATCH);
    if (batch.length === 0) return;
    for (const m of batch) {
      if (m.body == null || m.meta == null) continue;
      const plain = openBody(m.body, m.meta, priv, pubkeyB64, conversationId, m.id);
      await updateMessageBody(m.id, plain, null);
    }
    await yieldToUi();
  }
}

// Boot time self heal: a crash mid enable can leave plaintext rows in a locked chat.
// Needs only the pubkeys, so it runs without any authentication.
export async function sealPendingForLockedChats(): Promise<void> {
  let locked;
  try {
    locked = await listLockedConversations();
  } catch {
    return;
  }
  for (const convo of locked) {
    if (!convo.lockPubkey) continue;
    try {
      await sealHistory(convo.id, convo.lockPubkey);
    } catch {
      // Best effort; the next boot retries.
    }
  }
}

