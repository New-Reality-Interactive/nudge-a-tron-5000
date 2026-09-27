import type { Temporal } from "temporal-polyfill";

export type Strength = "gentle" | "firm" | "relentless";

/** ntfy priority: 1 (min) to 5 (max/urgent). */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** Safety cap for one occurrence. Whichever limit is reached first closes it as MISSED(cap). */
export interface Cap {
  maxDurationMinutes: number;
  maxAttempts: number;
}

/**
 * A daily window in the user's local time, half-open: [start, end). A window with
 * start > end crosses midnight. start == end is an empty window.
 */
export interface QuietHours {
  start: Temporal.PlainTime;
  end: Temporal.PlainTime;
}

export type ReminderStatus = "ACTIVE" | "COMPLETED" | "DELETED";

export interface Reminder {
  id: string;
  title: string;
  body?: string;
  /** Local wall-clock start, interpreted in `timezone`. */
  dtstart: Temporal.PlainDateTime;
  /** IANA time zone, e.g. `America/New_York`. */
  timezone: string;
  /** RFC 5545 RRULE (without the `RRULE:` prefix), or null for a one-shot reminder. */
  rrule: string | null;
  strength: Strength;
  /** Per-reminder cap. Unset fields fall back to `DEFAULT_CAP`. */
  cap: Partial<Cap>;
  status: ReminderStatus;
}

export type OccurrenceState = "PENDING" | "NAGGING" | "ACKED" | "MISSED" | "CANCELLED";
export type CloseReason = "cap" | "superseded";

interface OccurrenceBase {
  id: string;
  reminderId: string;
  scheduledFor: Temporal.Instant;
  /** Level of the most recent nag, or the starting level before the first nag. */
  level: number;
  /** Nags sent so far. Quiet-hours deferrals don't count. */
  attempts: number;
}

export interface OpenOccurrence extends OccurrenceBase {
  state: "PENDING" | "NAGGING";
  nextNagAt: Temporal.Instant;
  closedAt: null;
  closeReason: null;
}

export interface AckedOccurrence extends OccurrenceBase {
  state: "ACKED";
  nextNagAt: null;
  closedAt: Temporal.Instant;
  closeReason: null;
}

export interface MissedOccurrence extends OccurrenceBase {
  state: "MISSED";
  nextNagAt: null;
  closedAt: Temporal.Instant;
  closeReason: CloseReason;
}

/** Closed because its reminder was deleted. See ADR 0006. */
export interface CancelledOccurrence extends OccurrenceBase {
  state: "CANCELLED";
  nextNagAt: null;
  closedAt: Temporal.Instant;
  closeReason: null;
}

export type ClosedOccurrence = AckedOccurrence | MissedOccurrence | CancelledOccurrence;
export type Occurrence = OpenOccurrence | ClosedOccurrence;

interface EventDataByType {
  SCHEDULED: { level: number };
  NAG_SENT: { attempt: number; level: number; priority: Priority };
  /**
   * Recorded by the delivery layer, never by the domain. `tries` counts failed
   * deliveries of this nag; `nextTryAt` is null once the outbox gives up on it.
   */
  SEND_FAILED: { attempt: number; tries: number; nextTryAt: Temporal.Instant | null };
  DEFERRED_QUIET: { until: Temporal.Instant };
  ACKED: Record<string, never>;
  MISSED: { reason: "cap" };
  SUPERSEDED: { by: string };
  CANCELLED: Record<string, never>;
}

export type EventType = keyof EventDataByType;

/** An audit event before the app layer assigns its id. */
export type EventDraft = {
  [T in EventType]: {
    occurrenceId: string;
    type: T;
    at: Temporal.Instant;
    data: EventDataByType[T];
  };
}[EventType];

export type Event = EventDraft & { id: string };
