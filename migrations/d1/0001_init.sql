-- D1 schema v1: global identity data (ADR 0001, ADR 0008). Everything per user lives in
-- that user's UserNudger Durable Object. Instants are INTEGER epoch milliseconds (UTC).
-- Forward-only and add-only (ADR 0007): never edit a migration once merged.

CREATE TABLE users (
  id         TEXT    PRIMARY KEY, -- UUIDv7; also the Durable Object name
  name       TEXT    NOT NULL,
  timezone   TEXT    NOT NULL,    -- IANA; the Durable Object holds the copy it schedules with
  created_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  key_id      TEXT    PRIMARY KEY, -- the <keyId> in nt5k_<keyId>_<secret>
  user_id     TEXT    NOT NULL REFERENCES users (id),
  secret_hash TEXT    NOT NULL,    -- lowercase hex SHA-256 of <secret>; the secret isn't stored
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER              -- NULL while the key is valid
);

CREATE INDEX api_keys_by_user ON api_keys (user_id);
