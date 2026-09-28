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
import { type Page, type PageRequest, probe, toPage } from "./pagination";
import type { ReminderRecord, UseCaseDeps } from "./ports";
import { type AppResult, invalid, notFound, ok } from "./result";
import { isTimeZone, saveTransition, valid } from "./shared";

type Schedule = Pick<Reminder, "dtstart" | "timezone" | "rrule">;

/**
 * Parses a schedule and rejects one that can't be scheduled as written: an unknown time
 * zone, a malformed `dtstart` or rule, or a `dtstart` that doesn't exist because it falls
 * in a daylight-saving gap (ADR 0004). The gap check needs `dtstart` and `timezone`
 * together, so it lives here rather than in the HTTP layer, which only sees the fields a
 * PATCH sends (ADR 0008). The RRULE limits are the HTTP layer's job.
 */
function parseSchedule(
  dtstart: string,
  timezone: string,
  rrule: string | null,
): AppResult<Schedule> {
  if (!isTimeZone(timezone)) return invalid(`unknown time zone: ${timezone}`, "timezone");

  let start: Temporal.PlainDateTime;
  try {
    start = Temporal.PlainDateTime.from(dtstart);
  } catch {
    return invalid("dtstart must be a local date-time, e.g. 2030-06-10T09:00", "dtstart");
  }
  // Resolving a local time in a gap moves it forward, so its wall-clock time changes. A
  // repeated local time (clocks going back) keeps it, and is allowed. Temporal's
  // "reject" disambiguation would refuse both.
  const resolved = start.toZonedDateTime(timezone, { disambiguation: "compatible" });
  if (!resolved.toPlainDateTime().equals(start)) {
    return invalid(
      `dtstart ${start.toString()} doesn't exist in ${timezone}: it falls in a daylight-saving gap`,
      "dtstart",
    );
  }

  const schedule = { dtstart: start, timezone, rrule };
  try {
    // Throws RangeError for a malformed rule.
    nextOccurrence(rrule, start, timezone, Temporal.Instant.fromEpochMilliseconds(0));
    return ok(schedule);
  } catch (error) {
    return invalid(
      `invalid rrule: ${error instanceof Error ? error.message : String(error)}`,
      "rrule",
    );
  }
}

/** The first occurrence at or after `from`. */
const firstOccurrence = (s: Schedule, from: Temporal.Instant): Temporal.Instant | null =>
  nextOccurrence(s.rrule, s.dtstart, s.timezone, from.subtract({ nanoseconds: 1 }));

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
 * occurrence to the new schedule's first slot at or after now, or at or after the
 * current next occurrence if that is already due but the alarm hasn't created it yet,
 * so an update never drops a due slot. An open occurrence keeps nagging. Strength and
 * cap changes apply from the next nag.
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
      const due = current.nextOccurrenceAt;
      const from = due !== null && Temporal.Instant.compare(due, now) < 0 ? due : now;
      nextOccurrenceAt = firstOccurrence(schedule, from);
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

/** A page of live reminders, oldest first. */
export function listReminders(deps: UseCaseDeps, page: PageRequest): Page<ReminderDto> {
  return toPage(deps.repo.listReminders(probe(page)), page, reminderToDto);
}
