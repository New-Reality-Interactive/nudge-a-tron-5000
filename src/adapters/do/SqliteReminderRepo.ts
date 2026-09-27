import { Temporal } from "temporal-polyfill";
import {
  DEFAULT_SETTINGS,
  type EventRecord,
  type Notification,
  type OutboxRow,
  type OutboxStatus,
  type ReminderRecord,
  type ReminderRepo,
  type Settings,
} from "../../app/ports";
import type {
  ClosedOccurrence,
  Event,
  EventType,
  Occurrence,
  OpenOccurrence,
  ReminderStatus,
  Strength,
} from "../../domain/types";

// Instants are stored as INTEGER epoch milliseconds (see migrations/do/0001_init.sql).

type ReminderRow = {
  id: string;
  title: string;
  body: string | null;
  dtstart: string;
  timezone: string;
  rrule: string | null;
  strength: string;
  cap_max_duration_minutes: number | null;
  cap_max_attempts: number | null;
  status: string;
  next_occurrence_at: number | null;
  created_at: number;
  updated_at: number;
};

type OccurrenceRow = {
  id: string;
  reminder_id: string;
  scheduled_for: number;
  level: number;
  attempts: number;
  state: string;
  next_nag_at: number | null;
  closed_at: number | null;
  close_reason: string | null;
};

type EventRow = { id: string; occurrence_id: string; type: string; at: number; data: string };

type OutboxDbRow = {
  id: string;
  occurrence_id: string;
  attempt: number;
  payload: string;
  status: string;
  tries: number;
  next_try_at: number | null;
  created_at: number;
  sent_at: number | null;
};

type SettingsRow = { timezone: string; quiet_start: string | null; quiet_end: string | null };

const ms = (instant: Temporal.Instant): number => instant.epochMilliseconds;
const msOrNull = (instant: Temporal.Instant | null): number | null =>
  instant?.epochMilliseconds ?? null;
const instant = (value: number): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(value);
const instantOrNull = (value: number | null): Temporal.Instant | null =>
  value === null ? null : instant(value);

const OCCURRENCE_COLUMNS =
  "id, reminder_id, scheduled_for, level, attempts, state, next_nag_at, closed_at, close_reason";

function toReminder(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    title: row.title,
    ...(row.body !== null ? { body: row.body } : {}),
    dtstart: Temporal.PlainDateTime.from(row.dtstart),
    timezone: row.timezone,
    rrule: row.rrule,
    strength: row.strength as Strength,
    cap: {
      ...(row.cap_max_duration_minutes !== null
        ? { maxDurationMinutes: row.cap_max_duration_minutes }
        : {}),
      ...(row.cap_max_attempts !== null ? { maxAttempts: row.cap_max_attempts } : {}),
    },
    status: row.status as ReminderStatus,
    nextOccurrenceAt: instantOrNull(row.next_occurrence_at),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

function toOccurrence(row: OccurrenceRow): Occurrence {
  // The CHECK constraints and the state machine keep state, nextNagAt, closedAt and
  // closeReason consistent, so the row matches exactly one Occurrence variant.
  return {
    id: row.id,
    reminderId: row.reminder_id,
    scheduledFor: instant(row.scheduled_for),
    level: row.level,
    attempts: row.attempts,
    state: row.state,
    nextNagAt: instantOrNull(row.next_nag_at),
    closedAt: instantOrNull(row.closed_at),
    closeReason: row.close_reason,
  } as Occurrence;
}

function toOutbox(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    occurrenceId: row.occurrence_id,
    attempt: row.attempt,
    payload: JSON.parse(row.payload) as Notification,
    status: row.status as OutboxStatus,
    tries: row.tries,
    nextTryAt: instantOrNull(row.next_try_at),
    createdAt: instant(row.created_at),
    sentAt: instantOrNull(row.sent_at),
  };
}

/** `ReminderRepo` on a Durable Object's SQLite storage. */
export class SqliteReminderRepo implements ReminderRepo {
  readonly #storage: DurableObjectStorage;
  readonly #sql: SqlStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
    this.#sql = storage.sql;
  }

  transaction<T>(fn: () => T): T {
    return this.#storage.transactionSync(fn);
  }

  getSettings(): Settings {
    const row = this.#sql
      .exec<SettingsRow>("SELECT timezone, quiet_start, quiet_end FROM settings WHERE id = 1")
      .toArray()[0];
    if (row === undefined) return { ...DEFAULT_SETTINGS };
    return {
      timezone: row.timezone,
      quietHours:
        row.quiet_start === null || row.quiet_end === null
          ? null
          : {
              start: Temporal.PlainTime.from(row.quiet_start),
              end: Temporal.PlainTime.from(row.quiet_end),
            },
    };
  }

  saveSettings(settings: Settings): void {
    const hhmm = (t: Temporal.PlainTime) => t.toString({ smallestUnit: "minute" });
    this.#sql.exec(
      `INSERT INTO settings (id, timezone, quiet_start, quiet_end) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         timezone = excluded.timezone,
         quiet_start = excluded.quiet_start,
         quiet_end = excluded.quiet_end`,
      settings.timezone,
      settings.quietHours === null ? null : hhmm(settings.quietHours.start),
      settings.quietHours === null ? null : hhmm(settings.quietHours.end),
    );
  }

  insertReminder(r: ReminderRecord): void {
    this.#sql.exec(
      `INSERT INTO reminders (id, title, body, dtstart, timezone, rrule, strength,
         cap_max_duration_minutes, cap_max_attempts, status, next_occurrence_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...this.#reminderValues(r),
    );
  }

  updateReminder(r: ReminderRecord): void {
    const [id, ...values] = this.#reminderValues(r);
    this.#sql.exec(
      `UPDATE reminders SET title = ?, body = ?, dtstart = ?, timezone = ?, rrule = ?,
         strength = ?, cap_max_duration_minutes = ?, cap_max_attempts = ?, status = ?,
         next_occurrence_at = ?, created_at = ?, updated_at = ?
       WHERE id = ?`,
      ...values,
      id,
    );
  }

  #reminderValues(r: ReminderRecord): SqlStorageValue[] {
    return [
      r.id,
      r.title,
      r.body ?? null,
      r.dtstart.toString(),
      r.timezone,
      r.rrule,
      r.strength,
      r.cap.maxDurationMinutes ?? null,
      r.cap.maxAttempts ?? null,
      r.status,
      msOrNull(r.nextOccurrenceAt),
      ms(r.createdAt),
      ms(r.updatedAt),
    ];
  }

  getReminder(id: string): ReminderRecord | null {
    const row = this.#sql
      .exec<ReminderRow>("SELECT * FROM reminders WHERE id = ?", id)
      .toArray()[0];
    return row === undefined ? null : toReminder(row);
  }

  listReminders(): ReminderRecord[] {
    return this.#sql
      .exec<ReminderRow>(
        "SELECT * FROM reminders WHERE status != 'DELETED' ORDER BY created_at, rowid",
      )
      .toArray()
      .map(toReminder);
  }

  dueReminders(now: Temporal.Instant): ReminderRecord[] {
    return this.#sql
      .exec<ReminderRow>(
        `SELECT * FROM reminders
         WHERE status = 'ACTIVE' AND next_occurrence_at IS NOT NULL AND next_occurrence_at <= ?
         ORDER BY next_occurrence_at, rowid`,
        ms(now),
      )
      .toArray()
      .map(toReminder);
  }

  insertOccurrence(o: Occurrence): void {
    this.#sql.exec(
      `INSERT INTO occurrences (${OCCURRENCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...this.#occurrenceValues(o),
    );
  }

  updateOccurrence(o: Occurrence): void {
    const [id, ...values] = this.#occurrenceValues(o);
    this.#sql.exec(
      `UPDATE occurrences SET reminder_id = ?, scheduled_for = ?, level = ?, attempts = ?,
         state = ?, next_nag_at = ?, closed_at = ?, close_reason = ?
       WHERE id = ?`,
      ...values,
      id,
    );
  }

  #occurrenceValues(o: Occurrence): SqlStorageValue[] {
    return [
      o.id,
      o.reminderId,
      ms(o.scheduledFor),
      o.level,
      o.attempts,
      o.state,
      msOrNull(o.nextNagAt),
      msOrNull(o.closedAt),
      o.closeReason,
    ];
  }

  getOccurrence(id: string): Occurrence | null {
    const row = this.#sql
      .exec<OccurrenceRow>(`SELECT ${OCCURRENCE_COLUMNS} FROM occurrences WHERE id = ?`, id)
      .toArray()[0];
    return row === undefined ? null : toOccurrence(row);
  }

  openOccurrence(reminderId: string): OpenOccurrence | null {
    const row = this.#sql
      .exec<OccurrenceRow>(
        `SELECT ${OCCURRENCE_COLUMNS} FROM occurrences
         WHERE reminder_id = ? AND next_nag_at IS NOT NULL
         ORDER BY scheduled_for DESC LIMIT 1`,
        reminderId,
      )
      .toArray()[0];
    return row === undefined ? null : (toOccurrence(row) as OpenOccurrence);
  }

  latestClosedOccurrence(reminderId: string): ClosedOccurrence | null {
    const row = this.#sql
      .exec<OccurrenceRow>(
        `SELECT ${OCCURRENCE_COLUMNS} FROM occurrences
         WHERE reminder_id = ? AND next_nag_at IS NULL
         ORDER BY scheduled_for DESC, rowid DESC LIMIT 1`,
        reminderId,
      )
      .toArray()[0];
    return row === undefined ? null : (toOccurrence(row) as ClosedOccurrence);
  }

  dueOccurrences(now: Temporal.Instant): OpenOccurrence[] {
    return this.#sql
      .exec<OccurrenceRow>(
        `SELECT ${OCCURRENCE_COLUMNS} FROM occurrences
         WHERE next_nag_at IS NOT NULL AND next_nag_at <= ?
         ORDER BY next_nag_at, rowid`,
        ms(now),
      )
      .toArray()
      .map((row) => toOccurrence(row) as OpenOccurrence);
  }

  listOccurrences(reminderId: string): Occurrence[] {
    return this.#sql
      .exec<OccurrenceRow>(
        `SELECT ${OCCURRENCE_COLUMNS} FROM occurrences
         WHERE reminder_id = ? ORDER BY scheduled_for DESC, rowid DESC`,
        reminderId,
      )
      .toArray()
      .map(toOccurrence);
  }

  appendEvents(events: readonly Event[]): void {
    for (const e of events) {
      this.#sql.exec(
        "INSERT INTO events (id, occurrence_id, type, at, data) VALUES (?, ?, ?, ?, ?)",
        e.id,
        e.occurrenceId,
        e.type,
        ms(e.at),
        // Temporal values serialize to ISO strings through their toJSON.
        JSON.stringify(e.data),
      );
    }
  }

  listEvents(occurrenceId: string): EventRecord[] {
    return this.#sql
      .exec<EventRow>(
        "SELECT id, occurrence_id, type, at, data FROM events WHERE occurrence_id = ? ORDER BY rowid",
        occurrenceId,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        occurrenceId: row.occurrence_id,
        type: row.type as EventType,
        at: instant(row.at),
        data: JSON.parse(row.data) as EventRecord["data"],
      }));
  }

  insertOutbox(row: OutboxRow): void {
    this.#sql.exec(
      `INSERT INTO outbox (id, occurrence_id, attempt, payload, status, tries, next_try_at,
         created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      row.id,
      row.occurrenceId,
      row.attempt,
      JSON.stringify(row.payload),
      row.status,
      row.tries,
      msOrNull(row.nextTryAt),
      ms(row.createdAt),
      msOrNull(row.sentAt),
    );
  }

  updateOutbox(row: OutboxRow): void {
    this.#sql.exec(
      "UPDATE outbox SET status = ?, tries = ?, next_try_at = ?, sent_at = ? WHERE id = ?",
      row.status,
      row.tries,
      msOrNull(row.nextTryAt),
      msOrNull(row.sentAt),
      row.id,
    );
  }

  dueOutbox(now: Temporal.Instant): OutboxRow[] {
    return this.#sql
      .exec<OutboxDbRow>(
        `SELECT * FROM outbox
         WHERE status = 'PENDING' AND next_try_at <= ?
         ORDER BY next_try_at, rowid`,
        ms(now),
      )
      .toArray()
      .map(toOutbox);
  }

  nextWakeAt(): Temporal.Instant | null {
    const row = this.#sql
      .exec<{ at: number | null }>(
        `SELECT MIN(at) AS at FROM (
           SELECT MIN(next_nag_at) AS at FROM occurrences WHERE next_nag_at IS NOT NULL
           UNION ALL
           SELECT MIN(next_occurrence_at) FROM reminders
             WHERE status = 'ACTIVE' AND next_occurrence_at IS NOT NULL
           UNION ALL
           SELECT MIN(next_try_at) FROM outbox WHERE status = 'PENDING'
         )`,
      )
      .one();
    return instantOrNull(row.at);
  }
}
