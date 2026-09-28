import { Temporal } from "temporal-polyfill";
import { deliverOutbox, processDue } from "../../../src/app/alarm";
import type { CreateReminderInput, ReminderDto } from "../../../src/app/dto";
import type { PageRequest } from "../../../src/app/pagination";
import type { UseCaseDeps } from "../../../src/app/ports";
import { createReminder } from "../../../src/app/reminders";
import type { AppResult } from "../../../src/app/result";
import {
  FakeClock,
  FakeNotifier,
  InMemoryReminderRepo,
  SequentialIdGenerator,
} from "../../support/fakes";

/** A page big enough for any test. */
export const ALL: PageRequest = { limit: 1000, after: null };

/** 2030-06-10T09:00 in UTC, the default settings' time zone. */
export const T0 = Temporal.Instant.from("2030-06-10T09:00:00Z");

export interface Harness {
  clock: FakeClock;
  repo: InMemoryReminderRepo;
  notifier: FakeNotifier;
  deps: UseCaseDeps;
}

export function harness(start = T0): Harness {
  const clock = new FakeClock(start);
  const repo = new InMemoryReminderRepo();
  const deps = { repo, clock, ids: new SequentialIdGenerator() };
  return { clock, repo, notifier: new FakeNotifier(), deps };
}

/** Unwraps a result that must succeed. */
export function value<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`unexpected ${result.error.code}: ${result.error.message}`);
  return result.value;
}

export const reminderInput = (
  overrides: Partial<CreateReminderInput> = {},
): CreateReminderInput => ({
  title: "Take the bins out",
  dtstart: "2030-06-10T09:00",
  timezone: "UTC",
  strength: "firm",
  ...overrides,
});

export const create = (h: Harness, overrides: Partial<CreateReminderInput> = {}): ReminderDto =>
  value(createReminder(h.deps, reminderInput(overrides)));

/** What the Durable Object's alarm does, at the clock's current time. */
export async function runAlarm(h: Harness): Promise<void> {
  const now = h.clock.now();
  processDue(h.deps, now);
  await deliverOutbox({ ...h.deps, notifier: h.notifier }, now);
}

/** Moves the clock to the next wake-up and runs the alarm. Fails if nothing is pending. */
export async function runNextAlarm(h: Harness): Promise<Temporal.Instant> {
  const next = h.repo.nextWakeAt();
  if (next === null) throw new Error("nothing pending");
  h.clock.set(next);
  await runAlarm(h);
  return next;
}

export const eventTypes = (h: Harness, occurrenceId: string): string[] =>
  h.repo.listEvents(occurrenceId).map((e) => e.type);
