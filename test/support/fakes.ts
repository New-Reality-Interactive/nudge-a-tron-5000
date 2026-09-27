import { Temporal } from "temporal-polyfill";
import {
  type Clock,
  DEFAULT_SETTINGS,
  type EventRecord,
  type IdGenerator,
  type Notification,
  type Notifier,
  type OutboxRow,
  type ReminderRecord,
  type ReminderRepo,
  type Settings,
} from "../../src/app/ports";
import type { ClosedOccurrence, Event, Occurrence, OpenOccurrence } from "../../src/domain/types";

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  #now: Temporal.Instant;

  constructor(start: Temporal.Instant) {
    this.#now = start;
  }

  now(): Temporal.Instant {
    return this.#now;
  }

  set(instant: Temporal.Instant): void {
    this.#now = instant;
  }

  advance(by: Temporal.DurationLike): void {
    this.#now = this.#now.add(by);
  }
}

/** Ids `${prefix}-000001`, `${prefix}-000002`, …, which also sort in creation order. */
export class SequentialIdGenerator implements IdGenerator {
  #count = 0;
  readonly #prefix: string;

  constructor(prefix = "id") {
    this.#prefix = prefix;
  }

  next(): string {
    this.#count++;
    return `${this.#prefix}-${String(this.#count).padStart(6, "0")}`;
  }
}

/** Records every send. `failNext(n)` makes the next n sends reject. */
export class FakeNotifier implements Notifier {
  readonly sent: Notification[] = [];
  #failures = 0;

  failNext(count: number): void {
    this.#failures = count;
  }

  async send(notification: Notification): Promise<void> {
    if (this.#failures > 0) {
      this.#failures--;
      throw new Error("delivery failed");
    }
    this.sent.push(notification);
  }
}

const cmp = (a: Temporal.Instant, b: Temporal.Instant) => Temporal.Instant.compare(a, b);
const due = (at: Temporal.Instant | null, now: Temporal.Instant): at is Temporal.Instant =>
  at !== null && cmp(at, now) <= 0;

/**
 * `ReminderRepo` in memory, for unit tests of the use cases. Mirrors the SQLite adapter's
 * semantics, including its orderings, JSON event data and outbox ON CONFLICT DO NOTHING.
 * Records are immutable values, so a transaction snapshots the maps and restores them
 * if its function throws.
 */
export class InMemoryReminderRepo implements ReminderRepo {
  settings: Settings | null = null;
  reminders = new Map<string, ReminderRecord>();
  occurrences = new Map<string, Occurrence>();
  events: EventRecord[] = [];
  outbox = new Map<string, OutboxRow>();

  transaction<T>(fn: () => T): T {
    const snapshot = {
      settings: this.settings,
      reminders: new Map(this.reminders),
      occurrences: new Map(this.occurrences),
      events: [...this.events],
      outbox: new Map(this.outbox),
    };
    try {
      return fn();
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  getSettings(): Settings {
    return this.settings ?? { ...DEFAULT_SETTINGS };
  }

  saveSettings(settings: Settings): void {
    this.settings = settings;
  }

  insertReminder(reminder: ReminderRecord): void {
    if (this.reminders.has(reminder.id)) throw new Error(`duplicate reminder ${reminder.id}`);
    this.reminders.set(reminder.id, reminder);
  }

  updateReminder(reminder: ReminderRecord): void {
    if (this.reminders.has(reminder.id)) this.reminders.set(reminder.id, reminder);
  }

  getReminder(id: string): ReminderRecord | null {
    return this.reminders.get(id) ?? null;
  }

  listReminders(): ReminderRecord[] {
    return [...this.reminders.values()].filter((r) => r.status !== "DELETED");
  }

  dueReminders(now: Temporal.Instant): ReminderRecord[] {
    return [...this.reminders.values()]
      .filter((r) => r.status === "ACTIVE" && due(r.nextOccurrenceAt, now))
      .sort((a, b) =>
        cmp(a.nextOccurrenceAt as Temporal.Instant, b.nextOccurrenceAt as Temporal.Instant),
      );
  }

  insertOccurrence(occurrence: Occurrence): void {
    if (this.occurrences.has(occurrence.id))
      throw new Error(`duplicate occurrence ${occurrence.id}`);
    this.occurrences.set(occurrence.id, occurrence);
  }

  updateOccurrence(occurrence: Occurrence): void {
    if (this.occurrences.has(occurrence.id)) this.occurrences.set(occurrence.id, occurrence);
  }

  getOccurrence(id: string): Occurrence | null {
    return this.occurrences.get(id) ?? null;
  }

  /** Newest first, ties broken by insertion order, newest first. */
  #byReminder(reminderId: string): Occurrence[] {
    return [...this.occurrences.values()]
      .filter((o) => o.reminderId === reminderId)
      .reverse()
      .sort((a, b) => cmp(b.scheduledFor, a.scheduledFor));
  }

  openOccurrence(reminderId: string): OpenOccurrence | null {
    return (this.#byReminder(reminderId).find((o) => o.nextNagAt !== null) ??
      null) as OpenOccurrence | null;
  }

  latestClosedOccurrence(reminderId: string): ClosedOccurrence | null {
    return (this.#byReminder(reminderId).find((o) => o.nextNagAt === null) ??
      null) as ClosedOccurrence | null;
  }

  dueOccurrences(now: Temporal.Instant): OpenOccurrence[] {
    return (
      [...this.occurrences.values()].filter((o) => due(o.nextNagAt, now)) as OpenOccurrence[]
    ).sort((a, b) => cmp(a.nextNagAt, b.nextNagAt));
  }

  listOccurrences(reminderId: string): Occurrence[] {
    return this.#byReminder(reminderId);
  }

  appendEvents(events: readonly Event[]): void {
    for (const e of events) {
      this.events.push({
        id: e.id,
        occurrenceId: e.occurrenceId,
        type: e.type,
        at: e.at,
        data: JSON.parse(JSON.stringify(e.data)) as EventRecord["data"],
      });
    }
  }

  listEvents(occurrenceId: string): EventRecord[] {
    return this.events.filter((e) => e.occurrenceId === occurrenceId);
  }

  insertOutbox(row: OutboxRow): void {
    if (!this.outbox.has(row.id)) this.outbox.set(row.id, row);
  }

  updateOutbox(row: OutboxRow): void {
    if (this.outbox.has(row.id)) this.outbox.set(row.id, row);
  }

  dueOutbox(now: Temporal.Instant): OutboxRow[] {
    return [...this.outbox.values()]
      .filter((r) => r.status === "PENDING" && due(r.nextTryAt, now))
      .sort((a, b) => cmp(a.nextTryAt as Temporal.Instant, b.nextTryAt as Temporal.Instant));
  }

  nextWakeAt(): Temporal.Instant | null {
    const candidates = [
      ...[...this.occurrences.values()].map((o) => o.nextNagAt),
      ...[...this.reminders.values()]
        .filter((r) => r.status === "ACTIVE")
        .map((r) => r.nextOccurrenceAt),
      ...[...this.outbox.values()].filter((r) => r.status === "PENDING").map((r) => r.nextTryAt),
    ].filter((at): at is Temporal.Instant => at !== null);
    return candidates.sort(cmp)[0] ?? null;
  }
}
