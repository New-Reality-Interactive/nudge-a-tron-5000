import { DurableObject } from "cloudflare:workers";
import { runMigrations } from "../adapters/do/migrate";
import { SqliteReminderRepo } from "../adapters/do/SqliteReminderRepo";
import { UnconfiguredNotifier } from "../adapters/notify/UnconfiguredNotifier";
import { SystemClock } from "../adapters/system/SystemClock";
import { UuidV7IdGenerator } from "../adapters/system/UuidV7IdGenerator";
import { deliverOutbox, processDue } from "../app/alarm";
import type {
  AckDto,
  CreateReminderInput,
  EventDto,
  OccurrenceDto,
  ReminderDto,
  SettingsDto,
  SettingsPatch,
  UpdateReminderInput,
} from "../app/dto";
import * as occurrences from "../app/occurrences";
import type { Clock, IdGenerator, Notifier, UseCaseDeps } from "../app/ports";
import * as reminders from "../app/reminders";
import type { AppResult } from "../app/result";
import * as settings from "../app/settings";
import { MIGRATIONS } from "./migrations";

export interface NudgerDeps {
  clock: Clock;
  ids: IdGenerator;
  notifier: Notifier;
}

/**
 * One instance per user (`idFromName(userId)`), SQLite-backed (ADR 0001, ADR 0006).
 * Holds the user's settings, reminders, occurrences, audit events and outbox, and keeps
 * a single alarm set to the earliest pending nag, occurrence or delivery retry.
 *
 * The public methods are its RPC surface for the HTTP API (M4) and the ack route (M5).
 * They take and return plain data, and report errors as `AppResult` values.
 */
export class UserNudger extends DurableObject<Env> {
  /**
   * Time, ids and delivery. Integration tests replace this through `runInDurableObject`
   * to control the clock and capture sends. RPC only exposes prototype methods, so it
   * can't be reached from outside the object.
   */
  deps: NudgerDeps;
  readonly #repo: SqliteReminderRepo;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const clock = new SystemClock();
    this.deps = { clock, ids: new UuidV7IdGenerator(clock), notifier: new UnconfiguredNotifier() };
    this.#repo = new SqliteReminderRepo(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage, MIGRATIONS, clock.now().epochMilliseconds);
    });
  }

  getSettings(): SettingsDto {
    return settings.getSettings(this.#deps());
  }

  /** Quiet hours and time zone apply from the next due nag, so the alarm doesn't move. */
  updateSettings(patch: SettingsPatch): AppResult<SettingsDto> {
    return settings.updateSettings(this.#deps(), patch);
  }

  createReminder(input: CreateReminderInput): Promise<AppResult<ReminderDto>> {
    return this.#thenReschedule(reminders.createReminder(this.#deps(), input));
  }

  getReminder(id: string): AppResult<ReminderDto> {
    return reminders.getReminder(this.#deps(), id);
  }

  listReminders(): ReminderDto[] {
    return reminders.listReminders(this.#deps());
  }

  updateReminder(id: string, patch: UpdateReminderInput): Promise<AppResult<ReminderDto>> {
    return this.#thenReschedule(reminders.updateReminder(this.#deps(), id, patch));
  }

  deleteReminder(id: string): Promise<AppResult<null>> {
    return this.#thenReschedule(reminders.deleteReminder(this.#deps(), id));
  }

  listOccurrences(reminderId: string): AppResult<OccurrenceDto[]> {
    return occurrences.listOccurrences(this.#deps(), reminderId);
  }

  listEvents(occurrenceId: string): AppResult<EventDto[]> {
    return occurrences.listEvents(this.#deps(), occurrenceId);
  }

  /** Idempotent: an occurrence that's already closed comes back as `already_closed`. */
  acknowledge(occurrenceId: string): Promise<AppResult<AckDto>> {
    return this.#thenReschedule(occurrences.acknowledge(this.#deps(), occurrenceId));
  }

  /**
   * The alarm step (ADR 0001): advance everything due in one transaction, deliver the
   * outbox after it commits, then set the next alarm. Replaying it finds nothing new to
   * do, so it never sends twice.
   */
  override async alarm(): Promise<void> {
    const deps = this.#deps();
    const now = deps.clock.now();
    processDue(deps, now);
    await deliverOutbox({ ...deps, notifier: this.deps.notifier }, now);
    await this.#reschedule();
  }

  #deps(): UseCaseDeps {
    return { repo: this.#repo, clock: this.deps.clock, ids: this.deps.ids };
  }

  async #thenReschedule<T>(result: T): Promise<T> {
    await this.#reschedule();
    return result;
  }

  /** One alarm, at the earliest pending action, or none when nothing is pending. */
  async #reschedule(): Promise<void> {
    const next = this.#repo.nextWakeAt();
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next.epochMilliseconds);
    }
  }
}
