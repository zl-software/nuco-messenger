// Schema for the encrypted SQLCipher database. Everything here is protected at rest by
// SQLCipher, whose key is released only after biometric or PIN unlock. The Signal store
// (sessions, prekeys, identity key pair) lives here too, because secure-store values are
// size limited and the Signal store can exceed that limit.

export const SCHEMA_VERSION = 10;

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
    id                 TEXT PRIMARY KEY,
    handle             TEXT UNIQUE,
    display_name       TEXT NOT NULL,
    identity_pubkey    TEXT NOT NULL,
    fingerprint        TEXT,
    safety_number      TEXT,
    status             TEXT NOT NULL DEFAULT 'connected',
    verified_at        INTEGER,
    local_confirmed_at INTEGER,
    peer_confirmed_at  INTEGER,
    card_spk_pub       TEXT,
    card_kyber_pub     TEXT,
    blocked            INTEGER NOT NULL DEFAULT 0,
    muted              INTEGER NOT NULL DEFAULT 0,
    name_sync_pending  INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id                       TEXT PRIMARY KEY,
    contact_id               TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    retention_seconds          INTEGER NOT NULL DEFAULT 86400,
    retention_pending          INTEGER NOT NULL DEFAULT 0,
    retention_pending_value    INTEGER,
    retention_pending_incoming INTEGER NOT NULL DEFAULT 0,
    screenshot_protection       INTEGER NOT NULL DEFAULT 0,
    screenshot_pending          INTEGER NOT NULL DEFAULT 0,
    screenshot_pending_value    INTEGER,
    screenshot_pending_incoming INTEGER NOT NULL DEFAULT 0,
    lock_enabled               INTEGER NOT NULL DEFAULT 0,
    lock_bio_enabled           INTEGER NOT NULL DEFAULT 0,
    lock_pubkey                TEXT,
    lock_failed_attempts       INTEGER NOT NULL DEFAULT 0,
    lock_lockout_until         INTEGER NOT NULL DEFAULT 0,
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
    read            INTEGER NOT NULL DEFAULT 0,
    kind            TEXT NOT NULL DEFAULT 'text',
    reply_to_id     TEXT,
    media_meta      TEXT
  )`,

  // In flight incoming images (protocol 3.3). One row per announced transfer plus its
  // received chunks; assembled into a messages row (id = ref) once complete, then removed.
  // Incomplete transfers are garbage collected by the expiry sweeper. The chunk data is
  // plaintext base64 protected at rest by SQLCipher like message bodies; for chat locked
  // conversations the assembled body is sealed at completion (sealing the staged chunks
  // themselves would make assembly impossible while locked).
  `CREATE TABLE IF NOT EXISTS image_transfers (
    ref             TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    mime            TEXT NOT NULL,
    width           INTEGER NOT NULL,
    height          INTEGER NOT NULL,
    bytes           INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    chunks_total    INTEGER NOT NULL,
    sent_at         INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS image_chunks (
    ref  TEXT NOT NULL REFERENCES image_transfers(ref) ON DELETE CASCADE,
    seq  INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (ref, seq)
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
