// Coordinates the first run flow across screens: generate the database key and open the
// encrypted database, provision the account, set the PIN wrapped key, then go online and
// mark onboarding complete.

import { provisionDatabaseKey, setPinWrappedKey } from '@/crypto/secure-storage';
import { openEncryptedDb } from '@/db/client';
import { markUnlockedWithKey } from '@/lock/lock-controller';
import { provisionAccount, type Account } from './account';
import { goOnlineFirstRun } from './boot';
import { useSettings } from '@/state/settings';
import type { PreKeyUpload } from '@nuco/protocol';

interface Draft {
  displayName: string;
  dbKeyB64?: string;
  account?: Account;
  upload?: PreKeyUpload;
}

let draft: Draft = { displayName: '' };

export function setDisplayNameDraft(name: string): void {
  draft.displayName = name;
}
export function getDisplayNameDraft(): string {
  return draft.displayName;
}

// Generate keys: create the database key, open the encrypted db, and provision the account.
export async function runKeyGeneration(): Promise<{ fingerprint: string }> {
  const dbKeyB64 = await provisionDatabaseKey();
  await openEncryptedDb(dbKeyB64);
  markUnlockedWithKey(dbKeyB64);
  const { account, upload } = await provisionAccount(draft.displayName || 'You');
  draft.dbKeyB64 = dbKeyB64;
  draft.account = account;
  draft.upload = upload;
  return { fingerprint: formatFingerprint(account.identityKeyB64) };
}

export async function setPin(pin: string): Promise<void> {
  if (!draft.dbKeyB64) throw new Error('no database key in draft');
  await setPinWrappedKey(draft.dbKeyB64, pin);
}

export async function completeOnboarding(): Promise<void> {
  if (draft.account && draft.upload) {
    await goOnlineFirstRun(draft.account, draft.upload).catch(() => {
      // The relay may be unreachable during onboarding; the app retries on next launch.
    });
  }
  await useSettings.getState().update({ onboardingComplete: true });
  draft = { displayName: '' };
}

// A short, human readable fingerprint of the public identity key for display.
export function formatFingerprint(identityKeyB64: string): string {
  const hex = Array.from(atobBytes(identityKeyB64))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return (hex.slice(0, 32).match(/.{1,4}/g) ?? []).join(' ');
}

function atobBytes(b64: string): Uint8Array {
  // Local, dependency free decode for display only.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]!] = i;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of b64) {
    if (ch === '=') break;
    const v = lookup[ch];
    if (v === undefined) continue;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
