// Contacts repository. Verification is MUTUAL: local_confirmed_at records this user's
// emoji SAS confirmation, peer_confirmed_at records the peer's validated verify/confirm.
// A conversation is usable only when both are set (isMutuallyVerified); the legacy status
// column is promoted to 'verified' at that moment so existing UI reads keep working.

import { getDb } from '../client';

export type ContactStatus = 'connected' | 'verified';

export interface Contact {
  id: string;
  handle: string;
  displayName: string;
  identityPubkey: string;
  fingerprint: string | null;
  safetyNumber: string | null;
  status: ContactStatus;
  verifiedAt: number | null;
  localConfirmedAt: number | null;
  peerConfirmedAt: number | null;
  cardSpkPub: string | null;
  blocked: boolean;
  muted: boolean;
  createdAt: number;
}

interface ContactRow {
  id: string;
  handle: string;
  display_name: string;
  identity_pubkey: string;
  fingerprint: string | null;
  safety_number: string | null;
  status: string;
  verified_at: number | null;
  local_confirmed_at: number | null;
  peer_confirmed_at: number | null;
  card_spk_pub: string | null;
  blocked: number;
  muted: number;
  created_at: number;
}

function toContact(r: ContactRow): Contact {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    identityPubkey: r.identity_pubkey,
    fingerprint: r.fingerprint,
    safetyNumber: r.safety_number,
    status: r.status as ContactStatus,
    verifiedAt: r.verified_at,
    localConfirmedAt: r.local_confirmed_at,
    peerConfirmedAt: r.peer_confirmed_at,
    cardSpkPub: r.card_spk_pub,
    blocked: r.blocked === 1,
    muted: r.muted === 1,
    createdAt: r.created_at,
  };
}

export function isMutuallyVerified(c: Contact): boolean {
  return c.localConfirmedAt != null && c.peerConfirmedAt != null;
}

export async function listContacts(): Promise<Contact[]> {
  const result = await getDb().execute('SELECT * FROM contacts ORDER BY display_name COLLATE NOCASE');
  return (result.rows as unknown as ContactRow[]).map(toContact);
}

export async function getContact(id: string): Promise<Contact | null> {
  const result = await getDb().execute('SELECT * FROM contacts WHERE id = ?', [id]);
  return result.rows.length ? toContact(result.rows[0] as unknown as ContactRow) : null;
}

export async function getContactByHandle(handle: string): Promise<Contact | null> {
  const result = await getDb().execute('SELECT * FROM contacts WHERE handle = ?', [handle]);
  return result.rows.length ? toContact(result.rows[0] as unknown as ContactRow) : null;
}

export async function upsertContact(c: Contact): Promise<void> {
  await getDb().execute(
    `INSERT INTO contacts (id, handle, display_name, identity_pubkey, fingerprint, safety_number, status, verified_at,
                           local_confirmed_at, peer_confirmed_at, card_spk_pub, blocked, muted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       handle = excluded.handle, display_name = excluded.display_name, identity_pubkey = excluded.identity_pubkey,
       fingerprint = excluded.fingerprint, safety_number = excluded.safety_number, status = excluded.status,
       verified_at = excluded.verified_at, local_confirmed_at = excluded.local_confirmed_at,
       peer_confirmed_at = excluded.peer_confirmed_at, card_spk_pub = excluded.card_spk_pub,
       blocked = excluded.blocked, muted = excluded.muted`,
    [
      c.id,
      c.handle,
      c.displayName,
      c.identityPubkey,
      c.fingerprint,
      c.safetyNumber,
      c.status,
      c.verifiedAt,
      c.localConfirmedAt,
      c.peerConfirmedAt,
      c.cardSpkPub,
      c.blocked ? 1 : 0,
      c.muted ? 1 : 0,
      c.createdAt,
    ],
  );
}

export async function setLocalConfirmed(id: string, safetyNumber: string, at: number): Promise<void> {
  await getDb().execute(
    `UPDATE contacts SET local_confirmed_at = ?, safety_number = ?,
       status = CASE WHEN peer_confirmed_at IS NOT NULL THEN 'verified' ELSE status END,
       verified_at = CASE WHEN peer_confirmed_at IS NOT NULL THEN ? ELSE verified_at END
     WHERE id = ?`,
    [at, safetyNumber, at, id],
  );
}

export async function setPeerConfirmed(id: string, at: number): Promise<void> {
  await getDb().execute(
    `UPDATE contacts SET peer_confirmed_at = ?,
       status = CASE WHEN local_confirmed_at IS NOT NULL THEN 'verified' ELSE status END,
       verified_at = CASE WHEN local_confirmed_at IS NOT NULL THEN ? ELSE verified_at END
     WHERE id = ?`,
    [at, at, id],
  );
}

export async function setBlocked(id: string, blocked: boolean): Promise<void> {
  await getDb().execute('UPDATE contacts SET blocked = ? WHERE id = ?', [blocked ? 1 : 0, id]);
}

export async function setMuted(id: string, muted: boolean): Promise<void> {
  await getDb().execute('UPDATE contacts SET muted = ? WHERE id = ?', [muted ? 1 : 0, id]);
}

export async function deleteContact(id: string): Promise<void> {
  await getDb().execute('DELETE FROM contacts WHERE id = ?', [id]);
}
