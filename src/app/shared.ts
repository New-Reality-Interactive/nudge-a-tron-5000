import { Temporal } from "temporal-polyfill";
import type { TransitionResult } from "../domain/occurrence";
import type { Event, EventDraft, Occurrence } from "../domain/types";
import type { IdGenerator, ReminderRepo } from "./ports";

/** Gives each event draft an id. */
export const withIds = (ids: IdGenerator, drafts: readonly EventDraft[]): Event[] =>
  drafts.map((draft) => ({ ...draft, id: ids.next() }));

/**
 * Unwraps a transition the caller has already checked is valid. A failure here is a
 * bug, so it throws, which rolls back the surrounding transaction.
 */
export function valid(result: TransitionResult): Extract<TransitionResult, { ok: true }>["value"] {
  if (!result.ok) {
    throw new Error(`invalid transition ${result.error.input} on ${result.error.state}`);
  }
  return result.value;
}

/** Writes a transitioned occurrence and its events. */
export function saveTransition(
  repo: ReminderRepo,
  ids: IdGenerator,
  occurrence: Occurrence,
  events: readonly EventDraft[],
): void {
  repo.updateOccurrence(occurrence);
  repo.appendEvents(withIds(ids, events));
}

/**
 * Marks an ACTIVE reminder COMPLETED once its series has ended and its last
 * occurrence has closed.
 */
export function completeIfFinished(repo: ReminderRepo, reminderId: string): void {
  const reminder = repo.getReminder(reminderId);
  if (
    reminder !== null &&
    reminder.status === "ACTIVE" &&
    reminder.nextOccurrenceAt === null &&
    repo.openOccurrence(reminderId) === null
  ) {
    repo.updateReminder({ ...reminder, status: "COMPLETED" });
  }
}

/**
 * Whether `tz` is exactly an IANA time zone name that Temporal knows, e.g.
 * `America/New_York`. Temporal also resolves other strings to a zone: other casings
 * (`america/new_york`), whole date-times (`2020-01-01T00:00Z`) and fixed offsets
 * (`+05:00`). Those are refused, so what's stored and returned is always the name as
 * written (ADR 0008).
 */
export function isTimeZone(tz: string): boolean {
  if (/^[+-]/.test(tz)) return false;
  try {
    return Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tz).timeZoneId === tz;
  } catch {
    return false;
  }
}

/** Lowercase hex. */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
