import { transition } from "../domain/occurrence";
import { type AckDto, type EventDto, eventToDto, type OccurrenceDto, occurrenceToDto } from "./dto";
import { type Page, type PageRequest, probe, toPage } from "./pagination";
import type { UseCaseDeps } from "./ports";
import { type AppResult, notFound, ok } from "./result";
import { completeIfFinished, saveTransition, valid } from "./shared";

/** A page of a reminder's occurrences, newest first. */
export function listOccurrences(
  deps: UseCaseDeps,
  reminderId: string,
  page: PageRequest,
): AppResult<Page<OccurrenceDto>> {
  const reminder = deps.repo.getReminder(reminderId);
  if (reminder === null || reminder.status === "DELETED") return notFound("reminder");
  return ok(toPage(deps.repo.listOccurrences(reminderId, probe(page)), page, occurrenceToDto));
}

/** A page of an occurrence's audit events, oldest first. */
export function listEvents(
  deps: UseCaseDeps,
  occurrenceId: string,
  page: PageRequest,
): AppResult<Page<EventDto>> {
  if (deps.repo.getOccurrence(occurrenceId) === null) return notFound("occurrence");
  return ok(toPage(deps.repo.listEvents(occurrenceId, probe(page)), page, eventToDto));
}

/**
 * Acknowledges an occurrence, which stops its nags. Idempotent: acknowledging one that's
 * already closed (acked, missed or cancelled) changes nothing and says so.
 */
export function acknowledge(deps: UseCaseDeps, occurrenceId: string): AppResult<AckDto> {
  const { repo, clock, ids } = deps;
  return repo.transaction(() => {
    const occurrence = repo.getOccurrence(occurrenceId);
    if (occurrence === null) return notFound("occurrence");
    if (occurrence.nextNagAt === null) {
      return ok({ outcome: "already_closed", occurrence: occurrenceToDto(occurrence) });
    }

    const t = valid(transition(occurrence, { kind: "ACK" }, clock.now()));
    saveTransition(repo, ids, t.occurrence, t.events);
    completeIfFinished(repo, occurrence.reminderId);
    return ok({ outcome: "acked", occurrence: occurrenceToDto(t.occurrence) });
  });
}
