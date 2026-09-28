-- UserNudger schema v2: stored results for Idempotency-Key replays (ADR 0008).
-- Forward-only: never edit a migration once merged; add a new file instead.

CREATE TABLE idempotency_keys (
  key         TEXT    PRIMARY KEY,
  fingerprint TEXT    NOT NULL, -- SHA-256 of the method, path and canonical body
  result      TEXT    NOT NULL, -- JSON AppResult
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX idempotency_keys_expiry ON idempotency_keys (expires_at);
