import type { Temporal } from "temporal-polyfill";
import type {
  Cap,
  CloseReason,
  EventType,
  Occurrence,
  OccurrenceState,
  QuietHours,
  ReminderStatus,
  Strength,
} from "../domain/types";
import type { EventData, EventRecord, ReminderRecord, Settings } from "./ports";

// Plain data for Durable Object RPC: Temporal values don't survive serialization, so
// instants are ISO 8601 strings, `dtstart` is a local ISO date-time and times are HH:MM.

export interface CreateReminderInput {
  title: string;
  body?: string | null;
  /** Local date-time, e.g. `2026-10-01T09:00`, interpreted in `timezone`. */
  dtstart: string;
  timezone: string;
  /** RFC 5545 RRULE without the `RRULE:` prefix. Null or absent for a one-shot. */
  rrule?: string | null;
  strength: Strength;
  cap?: Partial<Cap>;
}

/** Only the fields present change. `body: null` clears the body. */
export type UpdateReminderInput = Partial<CreateReminderInput>;

export interface ReminderDto {
  id: string;
  title: string;
  body: string | null;
  dtstart: string;
  timezone: string;
  rrule: string | null;
  strength: Strength;
  cap: Partial<Cap>;
  status: ReminderStatus;
  nextOccurrenceAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OccurrenceDto {
  id: string;
  reminderId: string;
  scheduledFor: string;
  level: number;
  attempts: number;
  state: OccurrenceState;
  nextNagAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason | null;
}

export interface EventDto {
  id: string;
  occurrenceId: string;
  type: EventType;
  at: string;
  data: EventData;
}

export interface QuietHoursDto {
  /** HH:MM local time. */
  start: string;
  end: string;
}

export interface SettingsDto {
  timezone: string;
  quietHours: QuietHoursDto | null;
}

export type SettingsPatch = Partial<SettingsDto>;

export type AckOutcome = "acked" | "already_closed";

export interface AckDto {
  outcome: AckOutcome;
  occurrence: OccurrenceDto;
}

const iso = (instant: Temporal.Instant | null): string | null => instant?.toString() ?? null;

const hhmm = (time: Temporal.PlainTime): string => time.toString({ smallestUnit: "minute" });

export function reminderToDto(r: ReminderRecord): ReminderDto {
  return {
    id: r.id,
    title: r.title,
    body: r.body ?? null,
    dtstart: r.dtstart.toString(),
    timezone: r.timezone,
    rrule: r.rrule,
    strength: r.strength,
    cap: { ...r.cap },
    status: r.status,
    nextOccurrenceAt: iso(r.nextOccurrenceAt),
    createdAt: r.createdAt.toString(),
    updatedAt: r.updatedAt.toString(),
  };
}

export function occurrenceToDto(o: Occurrence): OccurrenceDto {
  return {
    id: o.id,
    reminderId: o.reminderId,
    scheduledFor: o.scheduledFor.toString(),
    level: o.level,
    attempts: o.attempts,
    state: o.state,
    nextNagAt: iso(o.nextNagAt),
    closedAt: iso(o.closedAt),
    closeReason: o.closeReason,
  };
}

export function eventToDto(e: EventRecord): EventDto {
  return {
    id: e.id,
    occurrenceId: e.occurrenceId,
    type: e.type,
    at: e.at.toString(),
    data: e.data,
  };
}

export function quietHoursToDto(q: QuietHours): QuietHoursDto {
  return { start: hhmm(q.start), end: hhmm(q.end) };
}

export function settingsToDto(s: Settings): SettingsDto {
  return {
    timezone: s.timezone,
    quietHours: s.quietHours === null ? null : quietHoursToDto(s.quietHours),
  };
}
