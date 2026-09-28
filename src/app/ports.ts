import type { Temporal } from "temporal-polyfill";
import type {
  ClosedOccurrence,
  Event,
  EventType,
  Occurrence,
  OpenOccurrence,
  Priority,
  QuietHours,
  Reminder,
} from "../domain/types";
import type { PageRequest } from "./pagination";

/** The only source of "now" for use cases. Production reads the system clock. */
export interface Clock {
  now(): Temporal.Instant;
}

/** Source of entity ids. Production uses UUIDv7; tests use sequential ids. */
export interface IdGenerator {
  next(): string;
}

/**
 * One nag to deliver. Titles only (ADR 0002): the body opt-in arrives with the ntfy
 * adapter in Milestone 5.
 */
export interface Notification {
  occurrenceId: string;
  reminderId: string;
  attempt: number;
  level: number;
  priority: Priority;
  title: string;
}

/** Delivers a nag. Rejects when delivery failed, so the outbox retries it. */
export interface Notifier {
  send(notification: Notification): Promise<void>;
}

/** The user's settings, stored in their Durable Object. */
export interface Settings {
  timezone: string;
  quietHours: QuietHours | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { timezone: "UTC", quietHours: null };

export interface ReminderRecord extends Reminder {
  /** When the next occurrence is created. Null once the series has ended or was deleted. */
  nextOccurrenceAt: Temporal.Instant | null;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
}

/**
 * Event data as stored: JSON, with instants as ISO strings. Every event type's data is
 * flat, which also keeps the type simple enough for Durable Object RPC's type mapping.
 */
export type EventData = Record<string, string | number | null>;

/** A stored event. */
export interface EventRecord {
  id: string;
  occurrenceId: string;
  type: EventType;
  at: Temporal.Instant;
  data: EventData;
}

export type OutboxStatus = "PENDING" | "SENT" | "DEAD" | "SKIPPED";

export interface OutboxRow {
  /** `occurrenceId:attempt`, unique, so a replayed insert is a no-op. */
  id: string;
  occurrenceId: string;
  attempt: number;
  payload: Notification;
  status: OutboxStatus;
  /** Failed deliveries so far. */
  tries: number;
  /** Null unless PENDING. */
  nextTryAt: Temporal.Instant | null;
  createdAt: Temporal.Instant;
  sentAt: Temporal.Instant | null;
}

/**
 * Storage for one user's reminders. Synchronous, because the Durable Object SQL API is;
 * `transaction` runs `fn` atomically and rolls back if it throws.
 */
export interface ReminderRepo {
  transaction<T>(fn: () => T): T;

  getSettings(): Settings;
  saveSettings(settings: Settings): void;

  insertReminder(reminder: ReminderRecord): void;
  updateReminder(reminder: ReminderRecord): void;
  getReminder(id: string): ReminderRecord | null;
  /** Reminders that aren't DELETED, oldest first; all of them without `page`. */
  listReminders(page?: PageRequest): ReminderRecord[];
  /** ACTIVE reminders whose next occurrence is due at `now`. */
  dueReminders(now: Temporal.Instant): ReminderRecord[];

  insertOccurrence(occurrence: Occurrence): void;
  updateOccurrence(occurrence: Occurrence): void;
  getOccurrence(id: string): Occurrence | null;
  openOccurrence(reminderId: string): OpenOccurrence | null;
  /** The reminder's most recently scheduled closed occurrence. */
  latestClosedOccurrence(reminderId: string): ClosedOccurrence | null;
  /** Open occurrences whose next nag is due at `now`, earliest first. */
  dueOccurrences(now: Temporal.Instant): OpenOccurrence[];
  /** Newest first; all of them without `page`. */
  listOccurrences(reminderId: string, page?: PageRequest): Occurrence[];

  appendEvents(events: readonly Event[]): void;
  /** In the order they were appended; all of them without `page`. */
  listEvents(occurrenceId: string, page?: PageRequest): EventRecord[];

  /** Does nothing when a row with the same id exists. */
  insertOutbox(row: OutboxRow): void;
  updateOutbox(row: OutboxRow): void;
  /** PENDING rows due at `now`, earliest first. */
  dueOutbox(now: Temporal.Instant): OutboxRow[];

  /** The earliest pending nag, occurrence or outbox retry, or null when nothing is pending. */
  nextWakeAt(): Temporal.Instant | null;

  /** An unexpired idempotency record, or null. */
  getIdempotency(key: string): IdempotencyRecord | null;
  saveIdempotency(record: IdempotencyRecord): void;
  /** Deletes every record that expired at or before `now`. */
  purgeIdempotency(now: Temporal.Instant): void;
}

/** A stored result for an `Idempotency-Key` (ADR 0008). */
export interface IdempotencyRecord {
  key: string;
  /** Hash of the request the key was first used with. */
  fingerprint: string;
  /** The JSON-encoded `AppResult` the request returned. */
  result: string;
  createdAt: Temporal.Instant;
  expiresAt: Temporal.Instant;
}

/** What every use case needs. Delivery also needs a `Notifier`. */
export interface UseCaseDeps {
  repo: ReminderRepo;
  clock: Clock;
  ids: IdGenerator;
}
