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
