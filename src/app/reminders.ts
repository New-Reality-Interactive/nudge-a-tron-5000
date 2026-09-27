import { Temporal } from "temporal-polyfill";
import { transition } from "../domain/occurrence";
import { nextOccurrence } from "../domain/recurrence";
import type { Reminder } from "../domain/types";
import {
  type CreateReminderInput,
  type ReminderDto,
  reminderToDto,
  type UpdateReminderInput,
} from "./dto";
import type { ReminderRecord, UseCaseDeps } from "./ports";
import { type AppResult, invalid, notFound, ok } from "./result";
import { saveTransition, valid } from "./shared";

type Schedule = Pick<Reminder, "dtstart" | "timezone" | "rrule">;

/**
 * Parses a schedule. Full validation (RRULE limits, dtstart in a DST gap) is the HTTP
 * layer's job (Milestone 4); this only rejects what would break scheduling.
 */
function parseSchedule(
  dtstart: string,
  timezone: string,
  rrule: string | null,
): AppResult<Schedule> {
  try {
    const schedule = { dtstart: Temporal.PlainDateTime.from(dtstart), timezone, rrule };
    // Throws RangeError for an unknown time zone or a malformed rule.
    nextOccurrence(rrule, schedule.dtstart, timezone, Temporal.Instant.fromEpochMilliseconds(0));
    return ok(schedule);
  } catch (error) {
    return invalid(`invalid schedule: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The first occurrence at or after `now`. */
const firstOccurrence = (s: Schedule, now: Temporal.Instant): Temporal.Instant | null =>
  nextOccurrence(s.rrule, s.dtstart, s.timezone, now.subtract({ nanoseconds: 1 }));

const liveReminder = (deps: UseCaseDeps, id: string): ReminderRecord | null => {
  const reminder = deps.repo.getReminder(id);
  return reminder === null || reminder.status === "DELETED" ? null : reminder;
};

/**
 * Creates a reminder. Its first occurrence is the first slot at or after now; a one-shot
 * whose time has passed has none, so it's created COMPLETED.
 */
export function createReminder(
  deps: UseCaseDeps,
  input: CreateReminderInput,
): AppResult<ReminderDto> {
  const now = deps.clock.now();
  const schedule = parseSchedule(input.dtstart, input.timezone, input.rrule ?? null);
  if (!schedule.ok) return schedule;

  const next = firstOccurrence(schedule.value, now);
  const reminder: ReminderRecord = {
    id: deps.ids.next(),
    title: input.title,
    ...(input.body != null ? { body: input.body } : {}),
    ...schedule.value,
    strength: input.strength,
    cap: { ...input.cap },
    status: next === null ? "COMPLETED" : "ACTIVE",
    nextOccurrenceAt: next,
    createdAt: now,
    updatedAt: now,
  };
  deps.repo.insertReminder(reminder);
  return ok(reminderToDto(reminder));
}

/**
 * Updates a reminder. A schedule change (dtstart, timezone or rrule) moves the next
 * occurrence to the new schedule's first slot at or after now; an open occurrence keeps
 * nagging. Strength and cap changes apply from the next nag.
 */
export function updateReminder(
  deps: UseCaseDeps,
  id: string,
  patch: UpdateReminderInput,
): AppResult<ReminderDto> {
  const { repo, clock } = deps;
  return repo.transaction(() => {
    const current = liveReminder(deps, id);
    if (current === null) return notFound("reminder");
    const now = clock.now();

    let schedule: Schedule = current;
    let { nextOccurrenceAt, status } = current;
    if (patch.dtstart !== undefined || patch.timezone !== undefined || patch.rrule !== undefined) {
      const parsed = parseSchedule(
        patch.dtstart ?? current.dtstart.toString(),
        patch.timezone ?? current.timezone,
        patch.rrule === undefined ? current.rrule : patch.rrule,
      );
      if (!parsed.ok) return parsed;
      schedule = parsed.value;
      nextOccurrenceAt = firstOccurrence(schedule, now);
      status =
        nextOccurrenceAt !== null || repo.openOccurrence(id) !== null ? "ACTIVE" : "COMPLETED";
    }

    const { body: currentBody, ...rest } = current;
    const body = patch.body === undefined ? currentBody : patch.body;
    const updated: ReminderRecord = {
      ...rest,
      ...(body != null ? { body } : {}),
      title: patch.title ?? current.title,
      dtstart: schedule.dtstart,
      timezone: schedule.timezone,
      rrule: schedule.rrule,
      strength: patch.strength ?? current.strength,
      cap: patch.cap === undefined ? current.cap : { ...patch.cap },
      status,
      nextOccurrenceAt,
      updatedAt: now,
    };
    repo.updateReminder(updated);
    return ok(reminderToDto(updated));
  });
}

/**
 * Soft-deletes a reminder: no more occurrences, and an open one closes as CANCELLED.
 * Its history stays readable through its occurrences' events.
 */
export function deleteReminder(deps: UseCaseDeps, id: string): AppResult<null> {
  const { repo, clock, ids } = deps;
  return repo.transaction(() => {
    const current = liveReminder(deps, id);
    if (current === null) return notFound("reminder");
    const now = clock.now();

    const open = repo.openOccurrence(id);
    if (open !== null) {
      const t = valid(transition(open, { kind: "CANCEL" }, now));
      saveTransition(repo, ids, t.occurrence, t.events);
    }
    repo.updateReminder({ ...current, status: "DELETED", nextOccurrenceAt: null, updatedAt: now });
    return ok(null);
  });
}

export function getReminder(deps: UseCaseDeps, id: string): AppResult<ReminderDto> {
  const reminder = liveReminder(deps, id);
  return reminder === null ? notFound("reminder") : ok(reminderToDto(reminder));
}

export function listReminders(deps: UseCaseDeps): ReminderDto[] {
  return deps.repo.listReminders().map(reminderToDto);
}
