import { runDurableObjectAlarm } from "cloudflare:test";
import type { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { MAX_TRIES } from "../../src/app/alarm";
import type { CreateReminderInput } from "../../src/app/dto";
import {
  alarmAt,
  countRows,
  fireNextAlarm,
  replayAlarm,
  T0,
  type TestNudger,
  testNudger,
  value,
} from "./nudger";

const input = (overrides: Partial<CreateReminderInput> = {}): CreateReminderInput => ({
  title: "Take the bins out",
  dtstart: "2030-06-10T09:00",
  timezone: "UTC",
  strength: "firm",
  ...overrides,
});

const create = async (n: TestNudger, overrides: Partial<CreateReminderInput> = {}) =>
  value(await n.stub.createReminder(input(overrides)));

const occurrencesOf = async (n: TestNudger, reminderId: string) =>
  value(await n.stub.listOccurrences(reminderId));

const eventTypes = async (n: TestNudger, occurrenceId: string) =>
  value(await n.stub.listEvents(occurrenceId)).map((e) => e.type);

describe("UserNudger", () => {
  it("sets the alarm to a new reminder's first occurrence", async () => {
    const n = await testNudger(T0.subtract({ hours: 1 }));
    const reminder = await create(n);

    expect(reminder).toMatchObject({ status: "ACTIVE", nextOccurrenceAt: "2030-06-10T09:00:00Z" });
    expect(await alarmAt(n.stub)).toEqual(T0);
    expect(value(await n.stub.getReminder(reminder.id))).toEqual(reminder);
    expect(await n.stub.listReminders()).toEqual([reminder]);
  });

  it("sends the escalating sequence of intervals and priorities (firm)", async () => {
    const n = await testNudger();
    await create(n);
    const times: Temporal.Instant[] = [];
    for (let i = 0; i < 5; i++) times.push(await fireNextAlarm(n));

    expect(n.notifier.sent.map((s) => [s.attempt, s.level, s.priority])).toEqual([
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 4],
      [4, 3, 5],
      [5, 3, 5],
    ]);
    const gaps = times
      .slice(1)
      .map((t, i) => (times[i] as Temporal.Instant).until(t).total("minutes"));
    expect(gaps).toEqual([30, 15, 7.5, 5]);
  });

  it("sends nothing more for an occurrence acknowledged mid-sequence", async () => {
    const n = await testNudger();
    const reminder = await create(n, { rrule: "FREQ=DAILY" });
    await fireNextAlarm(n);
    await fireNextAlarm(n);
    const [occ] = await occurrencesOf(n, reminder.id);
    const id = occ?.id as string;

    const ack = value(await n.stub.acknowledge(id));
    expect(ack).toMatchObject({ outcome: "acked", occurrence: { state: "ACKED" } });
    // The alarm moves on to tomorrow's occurrence; nothing more for this one.
    expect(await alarmAt(n.stub)).toEqual(T0.add({ hours: 24 }));
    n.clock.advance({ hours: 1 });
    await replayAlarm(n);

    expect(n.notifier.sent.filter((s) => s.occurrenceId === id)).toHaveLength(2);
    expect(await eventTypes(n, id)).toEqual(["SCHEDULED", "NAG_SENT", "NAG_SENT", "ACKED"]);
    expect(value(await n.stub.acknowledge(id)).outcome).toBe("already_closed");
  });

  it("replaying the same alarm sends nothing extra and writes no duplicate events", async () => {
    const n = await testNudger();
    const reminder = await create(n);
    await fireNextAlarm(n);
    const events = await countRows(n, "events");
    const outbox = await countRows(n, "outbox");

    await replayAlarm(n);
    await replayAlarm(n);

    expect(n.notifier.sent).toHaveLength(1);
    expect(await countRows(n, "events")).toBe(events);
    expect(await countRows(n, "outbox")).toBe(outbox);
    const [occ] = await occurrencesOf(n, reminder.id);
    expect(occ).toMatchObject({ attempts: 1, nextNagAt: "2030-06-10T09:30:00Z" });
  });

  it("records SEND_FAILED, retries after the backoff, then sends exactly once", async () => {
    const n = await testNudger();
    const reminder = await create(n);
    n.notifier.failNext(1);

    await fireNextAlarm(n);
    const [occ] = await occurrencesOf(n, reminder.id);
    const id = occ?.id as string;
    expect(n.notifier.sent).toHaveLength(0);
    expect(value(await n.stub.listEvents(id)).at(-1)).toMatchObject({
      type: "SEND_FAILED",
      data: { attempt: 1, tries: 1, nextTryAt: "2030-06-10T09:00:30Z" },
    });
    expect(await alarmAt(n.stub)).toEqual(T0.add({ seconds: 30 }));

    await fireNextAlarm(n);
    await replayAlarm(n);

    expect(n.notifier.sent.map((s) => s.attempt)).toEqual([1]);
    expect(await eventTypes(n, id)).toEqual(["SCHEDULED", "NAG_SENT", "SEND_FAILED"]);
    expect(await alarmAt(n.stub)).toEqual(T0.add({ minutes: 30 }));
  });

  it(`gives up on a nag after ${MAX_TRIES} failed tries`, async () => {
    const n = await testNudger();
    const reminder = await create(n);
    n.notifier.failNext(MAX_TRIES);
    for (let i = 0; i < MAX_TRIES; i++) await fireNextAlarm(n);

    const [occ] = await occurrencesOf(n, reminder.id);
    const failures = value(await n.stub.listEvents(occ?.id as string)).filter(
      (e) => e.type === "SEND_FAILED",
    );
    expect(failures.map((e) => e.data)).toEqual([
      { attempt: 1, tries: 1, nextTryAt: "2030-06-10T09:00:30Z" },
      { attempt: 1, tries: 2, nextTryAt: "2030-06-10T09:01:30Z" },
      { attempt: 1, tries: 3, nextTryAt: "2030-06-10T09:03:30Z" },
      { attempt: 1, tries: 4, nextTryAt: "2030-06-10T09:07:30Z" },
      { attempt: 1, tries: 5, nextTryAt: null },
    ]);
    expect(await alarmAt(n.stub)).toEqual(T0.add({ minutes: 30 }));
  });

  it("supersedes an unacknowledged occurrence and carries its level over", async () => {
    const n = await testNudger();
    const reminder = await create(n, { rrule: "FREQ=DAILY" });
    await fireNextAlarm(n); // level 0
    await fireNextAlarm(n); // level 1

    n.clock.set(T0.add({ hours: 24 }));
    expect(await runDurableObjectAlarm(n.stub)).toBe(true);

    const [next, previous] = await occurrencesOf(n, reminder.id);
    expect(previous).toMatchObject({ state: "MISSED", closeReason: "superseded", level: 1 });
    expect(await eventTypes(n, previous?.id as string)).toEqual([
      "SCHEDULED",
      "NAG_SENT",
      "NAG_SENT",
      "SUPERSEDED",
    ]);
    expect(next).toMatchObject({ state: "NAGGING", level: 2, attempts: 1 });
    expect(n.notifier.sent.at(-1)).toMatchObject({ occurrenceId: next?.id, level: 2, priority: 4 });
  });

  it("closes an occurrence as MISSED(cap) and completes a one-shot reminder", async () => {
    const n = await testNudger();
    const reminder = await create(n, { cap: { maxAttempts: 2 } });
    await fireNextAlarm(n);
    await fireNextAlarm(n);
    await fireNextAlarm(n);

    const [occ] = await occurrencesOf(n, reminder.id);
    expect(occ).toMatchObject({ state: "MISSED", closeReason: "cap", attempts: 2 });
    expect((await eventTypes(n, occ?.id as string)).at(-1)).toBe("MISSED");
    expect(value(await n.stub.getReminder(reminder.id)).status).toBe("COMPLETED");
    expect(await alarmAt(n.stub)).toBeNull();
    expect(n.notifier.sent).toHaveLength(2);
  });

  it("defers a nag in quiet hours with DEFERRED_QUIET, then sends at the window's end", async () => {
    const n = await testNudger(T0.add({ hours: 12 }));
    value(
      await n.stub.updateSettings({
        timezone: "America/New_York",
        quietHours: { start: "22:00", end: "07:00" },
      }),
    );
    expect(await n.stub.getSettings()).toEqual({
      timezone: "America/New_York",
      quietHours: { start: "22:00", end: "07:00" },
    });
    // 23:00 in New York (EDT) is 03:00Z.
    const reminder = await create(n, { dtstart: "2030-06-10T23:00", timezone: "America/New_York" });

    await fireNextAlarm(n);
    const [occ] = await occurrencesOf(n, reminder.id);
    expect(n.notifier.sent).toHaveLength(0);
    expect(value(await n.stub.listEvents(occ?.id as string)).at(-1)).toMatchObject({
      type: "DEFERRED_QUIET",
      data: { until: "2030-06-11T11:00:00Z" },
    });
    expect(await alarmAt(n.stub)).toEqual(T0.add({ hours: 26 }));

    await fireNextAlarm(n);
    expect(n.notifier.sent).toMatchObject([{ attempt: 1 }]);
  });

  it("holds a failed nag's retry through quiet hours instead of sending it there", async () => {
    const n = await testNudger(T0.add({ hours: 12, minutes: 59, seconds: 50 })); // 21:59:50Z
    value(await n.stub.updateSettings({ quietHours: { start: "22:00", end: "07:00" } }));
    const reminder = await create(n, { dtstart: "2030-06-10T21:59:50" });
    n.notifier.failNext(1);

    await fireNextAlarm(n); // fails; retry due at 22:00:20
    await fireNextAlarm(n); // inside the window: held until 07:00
    expect(n.notifier.sent).toHaveLength(0);
    await fireNextAlarm(n); // 22:29:50: the next nag is deferred to 07:00
    expect(await fireNextAlarm(n)).toEqual(T0.add({ hours: 22 }));

    const [occ] = await occurrencesOf(n, reminder.id);
    expect(n.notifier.sent.map((s) => s.attempt)).toEqual([2]);
    expect(await eventTypes(n, occ?.id as string)).toEqual([
      "SCHEDULED",
      "NAG_SENT",
      "SEND_FAILED",
      "DEFERRED_QUIET",
      "NAG_SENT",
    ]);
  });

  it("cancels the open occurrence and clears the alarm when a reminder is deleted", async () => {
    const n = await testNudger();
    const reminder = await create(n, { rrule: "FREQ=DAILY" });
    await fireNextAlarm(n);
    const [occ] = await occurrencesOf(n, reminder.id);

    expect(await n.stub.deleteReminder(reminder.id)).toEqual({ ok: true, value: null });

    expect(await alarmAt(n.stub)).toBeNull();
    expect(await n.stub.listReminders()).toEqual([]);
    expect(await n.stub.getReminder(reminder.id)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await eventTypes(n, occ?.id as string)).at(-1)).toBe("CANCELLED");
  });

  it("moves the alarm when an update changes the schedule", async () => {
    const n = await testNudger(T0.subtract({ hours: 2 }));
    const reminder = await create(n);
    const updated = value(
      await n.stub.updateReminder(reminder.id, { dtstart: "2030-06-10T08:00" }),
    );
    expect(updated.nextOccurrenceAt).toBe("2030-06-10T08:00:00Z");
    expect(await alarmAt(n.stub)).toEqual(T0.subtract({ hours: 1 }));
  });

  it("returns errors as values over RPC", async () => {
    const n = await testNudger();
    expect(await n.stub.createReminder(input({ timezone: "Nope/Nowhere" }))).toMatchObject({
      ok: false,
      error: { code: "INVALID" },
    });
    expect(await n.stub.acknowledge("missing")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
