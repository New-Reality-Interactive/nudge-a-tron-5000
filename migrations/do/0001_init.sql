-- UserNudger schema v1. Instants are INTEGER epoch milliseconds (UTC).
-- Forward-only: never edit a migration once merged; add a new file instead.

-- One row: the user's timezone and quiet hours (HH:MM local, both or neither).
CREATE TABLE settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  timezone    TEXT    NOT NULL,
  quiet_start TEXT,
  quiet_end   TEXT,
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

CREATE TABLE reminders (
  id                       TEXT    PRIMARY KEY,
  title                    TEXT    NOT NULL,
  body                     TEXT,
  dtstart                  TEXT    NOT NULL, -- ISO PlainDateTime, local to `timezone`
  timezone                 TEXT    NOT NULL,
  rrule                    TEXT,             -- NULL for a one-shot reminder
  strength                 TEXT    NOT NULL CHECK (strength IN ('gentle', 'firm', 'relentless')),
  cap_max_duration_minutes INTEGER,
  cap_max_attempts         INTEGER,
  status                   TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'DELETED')),
  -- When the next occurrence is created. NULL once the series has ended or was deleted.
  next_occurrence_at       INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX reminders_next_occurrence
  ON reminders (next_occurrence_at) WHERE next_occurrence_at IS NOT NULL;

CREATE TABLE occurrences (
  id            TEXT    PRIMARY KEY,
  reminder_id   TEXT    NOT NULL REFERENCES reminders (id),
  scheduled_for INTEGER NOT NULL,
  level         INTEGER NOT NULL,
  attempts      INTEGER NOT NULL,
  state         TEXT    NOT NULL CHECK (state IN ('PENDING', 'NAGGING', 'ACKED', 'MISSED', 'CANCELLED')),
  next_nag_at   INTEGER, -- NULL once closed
  closed_at     INTEGER,
  close_reason  TEXT    CHECK (close_reason IN ('cap', 'superseded'))
);

CREATE INDEX occurrences_next_nag ON occurrences (next_nag_at) WHERE next_nag_at IS NOT NULL;
CREATE INDEX occurrences_by_reminder ON occurrences (reminder_id, scheduled_for);

-- Append-only audit log. Listed in insertion (rowid) order.
CREATE TABLE events (
  id            TEXT    PRIMARY KEY,
  occurrence_id TEXT    NOT NULL REFERENCES occurrences (id),
  type          TEXT    NOT NULL,
  at            INTEGER NOT NULL,
  data          TEXT    NOT NULL -- JSON
);

CREATE INDEX events_by_occurrence ON events (occurrence_id);

-- One row per nag to deliver, keyed `occurrenceId:attempt` so a replayed insert is a no-op.
CREATE TABLE outbox (
  id            TEXT    PRIMARY KEY,
  occurrence_id TEXT    NOT NULL REFERENCES occurrences (id),
  attempt       INTEGER NOT NULL,
  payload       TEXT    NOT NULL, -- JSON Notification
  status        TEXT    NOT NULL CHECK (status IN ('PENDING', 'SENT', 'DEAD', 'SKIPPED')),
  tries         INTEGER NOT NULL DEFAULT 0, -- failed deliveries so far
  next_try_at   INTEGER, -- NULL unless PENDING
  created_at    INTEGER NOT NULL,
  sent_at       INTEGER
);

CREATE INDEX outbox_next_try ON outbox (next_try_at) WHERE status = 'PENDING';
