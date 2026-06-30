// Schema for the encrypted SQLCipher database. Everything here is protected at rest by
// SQLCipher, whose key is released only after biometric or PIN unlock. The Signal store
// (sessions, prekeys, identity key pair) lives here too, because secure-store values are
// size limited and the Signal store can exceed that limit.

export const SCHEMA_VERSION = 2;

export const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`,

  // The Signal protocol store, keyed by namespaced strings (see crypto/store.ts).
  `CREATE TABLE IF NOT EXISTS signal_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contacts (
    id              TEXT PRIMARY KEY,
    handle          TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    fingerprint     TEXT,
    safety_number   TEXT,
    status          TEXT NOT NULL DEFAULT 'connected',
    verified_at     INTEGER,
    blocked         INTEGER NOT NULL DEFAULT 0,
    muted           INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id                       TEXT PRIMARY KEY,
    contact_id               TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    retention_seconds          INTEGER NOT NULL DEFAULT 86400,
    retention_pending          INTEGER NOT NULL DEFAULT 0,
    retention_pending_value    INTEGER,
    retention_pending_incoming INTEGER NOT NULL DEFAULT 0,
    muted                      INTEGER NOT NULL DEFAULT 0,
    created_at                 INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction       TEXT NOT NULL,
    ciphertext_meta TEXT,
    body_encrypted  TEXT,
    status          TEXT NOT NULL DEFAULT 'sent',
    sent_at         INTEGER NOT NULL,
    expires_at      INTEGER,
    read            INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS push_endpoints (
    platform          TEXT PRIMARY KEY,
    token_or_endpoint TEXT,
    distributor       TEXT,
    updated_at        INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sent_at)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_expiry ON messages(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_handle ON contacts(handle)`,
];
