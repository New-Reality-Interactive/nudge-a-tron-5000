import { Temporal } from "temporal-polyfill";
import { effectiveCap } from "../domain/cap";
import { startLevel } from "../domain/carryOver";
import { scheduleOccurrence, transition } from "../domain/occurrence";
import { latestOccurrence, nextOccurrence } from "../domain/recurrence";
import type { OpenOccurrence } from "../domain/types";
import type { Notifier, OutboxRow, ReminderRecord, Settings, UseCaseDeps } from "./ports";
import { completeIfFinished, saveTransition, valid, withIds } from "./shared";

// The alarm step (ADR 0001, ADR 0006). Alarms fire at least once, so each part is
// idempotent: `processDue` only acts on what's due and moves it forward in the same
// transaction, and the outbox's `occurrenceId:attempt` key turns a replayed insert into
// a no-op. `deliverOutbox` runs after that transaction has committed.

/** Failed deliveries of one nag before the outbox gives up and marks it DEAD. */
export const MAX_TRIES = 5;

const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 5 * 60;

/** Wait before retrying a nag that has failed `tries` times: 30 s, doubling, up to 5 min. */
export function retryDelay(tries: number): Temporal.Duration {
  const seconds = Math.min(BASE_DELAY_SECONDS * 2 ** (tries - 1), MAX_DELAY_SECONDS);
  return Temporal.Duration.from({ seconds });
}

/**
 * In one transaction: starts every due occurrence (superseding the reminder's open
 * one), then advances every due nag and queues its notification in the outbox.
 */
export function processDue(deps: UseCaseDeps, now: Temporal.Instant): void {
  const { repo } = deps;
  repo.transaction(() => {
    const settings = repo.getSettings();
    for (const reminder of repo.dueReminders(now)) startOccurrence(deps, reminder, now);
    for (const occurrence of repo.dueOccurrences(now)) {
      nagOccurrence(deps, occurrence, settings, now);
    }
  });
}

/**
 * Creates the reminder's occurrence for its latest due slot. If the object slept through
 * several slots, the earlier ones are skipped rather than created and superseded at once.
 */
function startOccurrence(deps: UseCaseDeps, reminder: ReminderRecord, now: Temporal.Instant): void {
  const { repo, ids } = deps;
  const { dtstart, timezone, rrule } = reminder;
  const due = reminder.nextOccurrenceAt as Temporal.Instant;
  const latest = latestOccurrence(rrule, dtstart, timezone, now);
  const slot = latest !== null && Temporal.Instant.compare(latest, due) > 0 ? latest : due;

  const id = ids.next();
  const open = repo.openOccurrence(reminder.id);
  if (open !== null) {
    const t = valid(transition(open, { kind: "SUPERSEDE", by: id }, now));
    saveTransition(repo, ids, t.occurrence, t.events);
  }

  const level = startLevel(repo.latestClosedOccurrence(reminder.id), reminder.strength);
  const scheduled = scheduleOccurrence({ id, reminderId: reminder.id, scheduledFor: slot, level });
  repo.insertOccurrence(scheduled.occurrence);
  repo.appendEvents(withIds(ids, scheduled.events));

  repo.updateReminder({
    ...reminder,
    nextOccurrenceAt: nextOccurrence(rrule, dtstart, timezone, slot),
  });
}

function nagOccurrence(
  deps: UseCaseDeps,
  occurrence: OpenOccurrence,
  settings: Settings,
  now: Temporal.Instant,
): void {
  const { repo, ids } = deps;
  const reminder = repo.getReminder(occurrence.reminderId);
  if (reminder === null) throw new Error(`occurrence ${occurrence.id} has no reminder`);

  const t = valid(
    transition(
      occurrence,
      {
        kind: "NAG_DUE",
        policy: {
          strength: reminder.strength,
          cap: effectiveCap(reminder.cap),
          timezone: settings.timezone,
          quietHours: settings.quietHours,
        },
      },
      now,
    ),
  );
  saveTransition(repo, ids, t.occurrence, t.events);

  for (const event of t.events) {
    if (event.type !== "NAG_SENT") continue;
    const { attempt, level, priority } = event.data;
    repo.insertOutbox({
      id: `${occurrence.id}:${attempt}`,
      occurrenceId: occurrence.id,
      attempt,
      payload: {
        occurrenceId: occurrence.id,
        reminderId: reminder.id,
        attempt,
        level,
        priority,
        title: reminder.title,
      },
      status: "PENDING",
      tries: 0,
      nextTryAt: now,
      createdAt: now,
      sentAt: null,
    });
  }

  if (t.occurrence.nextNagAt === null) completeIfFinished(repo, reminder.id);
}

/**
 * Delivers every outbox row due at `now`. Call it after `processDue` has committed.
 * A row whose occurrence has closed, or has already moved on to a newer nag, is SKIPPED
 * instead, so a retry never nags after an ack. A failure records SEND_FAILED and retries
 * with backoff, up to MAX_TRIES, then marks the row DEAD. It never throws for a failed
 * send.
 */
export async function deliverOutbox(
  deps: UseCaseDeps & { notifier: Notifier },
  now: Temporal.Instant,
): Promise<void> {
  const { repo, clock, ids, notifier } = deps;
  for (const row of repo.dueOutbox(now)) {
    const occurrence = repo.getOccurrence(row.occurrenceId);
    if (occurrence === null || occurrence.nextNagAt === null || occurrence.attempts > row.attempt) {
      repo.updateOutbox({ ...row, status: "SKIPPED", nextTryAt: null });
      continue;
    }

    let failed = false;
    try {
      await notifier.send(row.payload);
    } catch {
      // The error isn't recorded: it could carry the destination (e.g. an ntfy topic).
      failed = true;
    }

    const at = clock.now();
    if (!failed) {
      repo.updateOutbox({ ...row, status: "SENT", nextTryAt: null, sentAt: at });
      continue;
    }
    const tries = row.tries + 1;
    const nextTryAt = tries >= MAX_TRIES ? null : at.add(retryDelay(tries));
    const failure: OutboxRow = {
      ...row,
      status: nextTryAt === null ? "DEAD" : "PENDING",
      tries,
      nextTryAt,
    };
    repo.transaction(() => {
      repo.updateOutbox(failure);
      repo.appendEvents(
        withIds(ids, [
          {
            occurrenceId: row.occurrenceId,
            type: "SEND_FAILED",
            at,
            data: { attempt: row.attempt, tries, nextTryAt },
          },
        ]),
      );
    });
  }
}
