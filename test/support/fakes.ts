import { Temporal } from "temporal-polyfill";
import type { PageRequest } from "../../src/app/pagination";
import {
  type ApiKeyRecord,
  type AuthStore,
  type Clock,
  DEFAULT_SETTINGS,
  type EventRecord,
  type IdempotencyRecord,
  type IdGenerator,
  type Notification,
  type Notifier,
  type OutboxRow,
  type ReminderRecord,
  type ReminderRepo,
  type Settings,
  type UserRecord,
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
 * The page of `ordered` after the item with id `page.after`, keeping only items that pass
 * `keep`. As in SQL, the cursor item itself needn't pass `keep`, and an unknown cursor
 * gives an empty page.
 */
function paged<T extends { id: string }>(
  ordered: readonly T[],
  page: PageRequest | undefined,
  keep: (item: T) => boolean = () => true,
): T[] {
  let rest = ordered;
  if (page?.after != null) {
    const i = ordered.findIndex((item) => item.id === page.after);
    rest = i < 0 ? [] : ordered.slice(i + 1);
  }
  const kept = rest.filter(keep);
  return page === undefined ? kept : kept.slice(0, page.limit);
}

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
  idempotency = new Map<string, IdempotencyRecord>();

  transaction<T>(fn: () => T): T {
    const snapshot = {
      settings: this.settings,
      reminders: new Map(this.reminders),
      occurrences: new Map(this.occurrences),
      events: [...this.events],
      outbox: new Map(this.outbox),
      idempotency: new Map(this.idempotency),
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

  listReminders(page?: PageRequest): ReminderRecord[] {
    return paged([...this.reminders.values()], page, (r) => r.status !== "DELETED");
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

  listOccurrences(reminderId: string, page?: PageRequest): Occurrence[] {
    return paged(this.#byReminder(reminderId), page);
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

  listEvents(occurrenceId: string, page?: PageRequest): EventRecord[] {
    return paged(
      this.events.filter((e) => e.occurrenceId === occurrenceId),
      page,
    );
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

  getIdempotency(key: string): IdempotencyRecord | null {
    return this.idempotency.get(key) ?? null;
  }

  saveIdempotency(record: IdempotencyRecord): void {
    if (this.idempotency.has(record.key)) throw new Error(`duplicate key ${record.key}`);
    this.idempotency.set(record.key, record);
  }

  purgeIdempotency(now: Temporal.Instant): void {
    for (const [key, record] of this.idempotency) {
      if (cmp(record.expiresAt, now) <= 0) this.idempotency.delete(key);
    }
  }
}

/** `AuthStore` in memory, mirroring the D1 adapter. */
export class InMemoryAuthStore implements AuthStore {
  users = new Map<string, UserRecord>();
  keys = new Map<string, ApiKeyRecord>();

  async findKey(keyId: string): Promise<{ key: ApiKeyRecord; user: UserRecord } | null> {
    const key = this.keys.get(keyId);
    const user = key === undefined ? undefined : this.users.get(key.userId);
    return key === undefined || user === undefined ? null : { key, user };
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async insertUser(user: UserRecord): Promise<void> {
    if (this.users.has(user.id)) throw new Error(`duplicate user ${user.id}`);
    this.users.set(user.id, user);
  }

  async updateUserTimezone(id: string, timezone: string): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, timezone });
  }

  async insertKey(key: ApiKeyRecord): Promise<void> {
    if (this.keys.has(key.keyId)) throw new Error(`duplicate key ${key.keyId}`);
    this.keys.set(key.keyId, key);
  }

  async revokeKey(userId: string, keyId: string, at: Temporal.Instant): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (key === undefined || key.userId !== userId) return false;
    this.keys.set(keyId, { ...key, revokedAt: key.revokedAt ?? at });
    return true;
  }
}

/** Random bytes from a counter: 0, 1, 2, … so issued keys are predictable. */
export function countingRandom(): (bytes: Uint8Array) => void {
  let next = 0;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = next++ & 0xff;
  };
}
