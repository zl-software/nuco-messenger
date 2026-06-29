// Contacts repository.

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
    blocked: r.blocked === 1,
    muted: r.muted === 1,
    createdAt: r.created_at,
  };
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
    `INSERT INTO contacts (id, handle, display_name, identity_pubkey, fingerprint, safety_number, status, verified_at, blocked, muted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       handle = excluded.handle, display_name = excluded.display_name, identity_pubkey = excluded.identity_pubkey,
       fingerprint = excluded.fingerprint, safety_number = excluded.safety_number, status = excluded.status,
       verified_at = excluded.verified_at, blocked = excluded.blocked, muted = excluded.muted`,
    [
      c.id,
      c.handle,
      c.displayName,
      c.identityPubkey,
      c.fingerprint,
      c.safetyNumber,
      c.status,
      c.verifiedAt,
      c.blocked ? 1 : 0,
      c.muted ? 1 : 0,
      c.createdAt,
    ],
  );
}

export async function setVerified(id: string, safetyNumber: string, verifiedAt: number): Promise<void> {
  await getDb().execute('UPDATE contacts SET status = ?, safety_number = ?, verified_at = ? WHERE id = ?', [
    'verified',
    safetyNumber,
    verifiedAt,
    id,
  ]);
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
