import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { MAX_TRIES, processDue, retryDelay } from "../../../src/app/alarm";
import { acknowledge } from "../../../src/app/occurrences";
import { deleteReminder, updateReminder } from "../../../src/app/reminders";
import { updateSettings } from "../../../src/app/settings";
import { create, eventTypes, harness, runAlarm, runNextAlarm, T0, value } from "./harness";

const minutes = (a: Temporal.Instant, b: Temporal.Instant) => a.until(b).total("minutes");

describe("retryDelay", () => {
  it("starts at 30 s and doubles, up to 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelay(n).total("seconds"))).toEqual([
      30, 60, 120, 240, 300, 300,
    ]);
  });
});

describe("processDue and deliverOutbox", () => {
  it("starts the first occurrence and sends its first nag when it's due", async () => {
    const h = harness();
    const reminder = create(h);
    expect(h.repo.nextWakeAt()).toEqual(T0);

    await runAlarm(h);

    const [occ] = h.repo.listOccurrences(reminder.id);
    expect(occ).toMatchObject({ state: "NAGGING", attempts: 1, level: 0 });
    expect(h.notifier.sent).toEqual([
      {
        occurrenceId: occ?.id,
        reminderId: reminder.id,
        attempt: 1,
        level: 0,
        priority: 3,
        title: "Take the bins out",
      },
    ]);
    expect(eventTypes(h, occ?.id as string)).toEqual(["SCHEDULED", "NAG_SENT"]);
    expect([...h.repo.outbox.values()].map((r) => r.status)).toEqual(["SENT"]);
  });

  it("does nothing when the alarm fires early", async () => {
    const h = harness(T0.subtract({ minutes: 5 }));
    create(h);
    await runAlarm(h);
    expect(h.repo.occurrences.size).toBe(0);
    expect(h.repo.nextWakeAt()).toEqual(T0);
  });

  it("sends the escalating sequence of the strength profile (firm)", async () => {
    const h = harness();
    create(h);
    const times: Temporal.Instant[] = [];
    for (let i = 0; i < 6; i++) times.push(await runNextAlarm(h));

    expect(h.notifier.sent.map((n) => [n.attempt, n.level, n.priority])).toEqual([
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 4],
      [4, 3, 5],
      [5, 3, 5],
      [6, 3, 5],
    ]);
    const gaps = times.slice(1).map((t, i) => minutes(times[i] as Temporal.Instant, t));
    expect(gaps).toEqual([30, 15, 7.5, 5, 5]);
  });

  it("sends nothing more once the occurrence is acknowledged", async () => {
    const h = harness();
    const reminder = create(h);
    await runNextAlarm(h);
    await runNextAlarm(h);
    const [occ] = h.repo.listOccurrences(reminder.id);

    value(acknowledge(h.deps, occ?.id as string));
    expect(h.repo.nextWakeAt()).toBeNull();
    h.clock.advance({ hours: 2 });
    await runAlarm(h);

    expect(h.notifier.sent).toHaveLength(2);
    expect(eventTypes(h, occ?.id as string)).toEqual([
      "SCHEDULED",
      "NAG_SENT",
      "NAG_SENT",
      "ACKED",
    ]);
  });

  it("is idempotent: replaying an alarm sends nothing and records nothing", async () => {
    const h = harness();
    create(h);
    await runNextAlarm(h);
    await runNextAlarm(h);
    const events = h.repo.events.length;

    await runAlarm(h);
    await runAlarm(h);

    expect(h.notifier.sent).toHaveLength(2);
    expect(h.repo.events).toHaveLength(events);
  });

  it("delivers a committed nag on the next alarm if delivery never ran", async () => {
    const h = harness();
    create(h);
    processDue(h.deps, h.clock.now()); // e.g. the object was evicted before delivering
    expect(h.notifier.sent).toHaveLength(0);
    expect(h.repo.nextWakeAt()).toEqual(T0);

    await runAlarm(h);
    expect(h.notifier.sent.map((n) => n.attempt)).toEqual([1]);
  });

  describe("delivery failures", () => {
    it("records SEND_FAILED, retries after the backoff, then sends exactly once", async () => {
      const h = harness();
      const reminder = create(h);
      h.notifier.failNext(1);

      await runAlarm(h);
      const [occ] = h.repo.listOccurrences(reminder.id);
      const id = occ?.id as string;
      expect(h.notifier.sent).toHaveLength(0);
      expect(h.repo.listEvents(id).at(-1)).toMatchObject({
        type: "SEND_FAILED",
        at: T0,
        data: { attempt: 1, tries: 1, nextTryAt: "2030-06-10T09:00:30Z" },
      });
      expect(h.repo.nextWakeAt()).toEqual(T0.add({ seconds: 30 }));

      await runNextAlarm(h);
      await runAlarm(h);
      expect(h.notifier.sent.map((n) => n.attempt)).toEqual([1]);
      expect(eventTypes(h, id)).toEqual(["SCHEDULED", "NAG_SENT", "SEND_FAILED"]);
      expect(h.repo.outbox.get(`${id}:1`)).toMatchObject({ status: "SENT", tries: 1 });
    });

    it(`marks the row DEAD after ${MAX_TRIES} failed tries`, async () => {
      const h = harness();
      const reminder = create(h);
      h.notifier.failNext(MAX_TRIES);

      await runAlarm(h);
      for (let i = 1; i < MAX_TRIES; i++) await runNextAlarm(h);

      const [occ] = h.repo.listOccurrences(reminder.id);
      const id = occ?.id as string;
      const failures = h.repo.listEvents(id).filter((e) => e.type === "SEND_FAILED");
      expect(failures.map((e) => e.data.tries)).toEqual([1, 2, 3, 4, 5]);
      expect(failures.at(-1)?.data.nextTryAt).toBeNull();
      expect(h.repo.outbox.get(`${id}:1`)).toMatchObject({ status: "DEAD", nextTryAt: null });
      // The occurrence itself carries on: its next nag is still scheduled.
      expect(h.repo.nextWakeAt()).toEqual(T0.add({ minutes: 30 }));
      expect(h.notifier.sent).toHaveLength(0);
    });

    it("holds a retry that falls in quiet hours; the deferred nag then supersedes it", async () => {
      const h = harness(Temporal.Instant.from("2030-06-10T21:59:50Z"));
      value(updateSettings(h.deps, { quietHours: { start: "22:00", end: "07:00" } }));
      const reminder = create(h, { dtstart: "2030-06-10T21:59:50" });
      h.notifier.failNext(1);
      await runAlarm(h); // fails; retry due at 22:00:20, inside the window

      await runNextAlarm(h);
      const [occ] = h.repo.listOccurrences(reminder.id);
      const id = occ?.id as string;
      expect(h.notifier.sent).toHaveLength(0);
      expect(h.repo.outbox.get(`${id}:1`)).toMatchObject({
        status: "PENDING",
        tries: 1,
        nextTryAt: Temporal.Instant.from("2030-06-11T07:00:00Z"),
      });
      expect(eventTypes(h, id).filter((t) => t === "SEND_FAILED")).toHaveLength(1);

      await runNextAlarm(h); // 22:29:50: the next nag is deferred to 07:00
      expect(await runNextAlarm(h)).toEqual(Temporal.Instant.from("2030-06-11T07:00:00Z"));
      expect(h.notifier.sent.map((n) => n.attempt)).toEqual([2]);
      expect(h.repo.outbox.get(`${id}:1`)).toMatchObject({ status: "SKIPPED" });
    });

    it("sends a held retry at the window's end when no newer nag is due", async () => {
      const h = harness(Temporal.Instant.from("2030-06-10T21:59:50Z"));
      value(updateSettings(h.deps, { quietHours: { start: "22:00", end: "22:30" } }));
      create(h, { dtstart: "2030-06-10T21:59:50", strength: "gentle" }); // next nag in 60 min
      h.notifier.failNext(1);
      await runAlarm(h);

      await runNextAlarm(h); // 22:00:20, held
      expect(await runNextAlarm(h)).toEqual(Temporal.Instant.from("2030-06-10T22:30:00Z"));
      expect(h.notifier.sent.map((n) => n.attempt)).toEqual([1]);
    });

    it("skips a pending retry once the occurrence is acknowledged", async () => {
      const h = harness();
      const reminder = create(h);
      h.notifier.failNext(1);
      await runAlarm(h);
      const [occ] = h.repo.listOccurrences(reminder.id);

      value(acknowledge(h.deps, occ?.id as string));
      h.clock.advance({ seconds: 30 });
      await runAlarm(h);

      expect(h.notifier.sent).toHaveLength(0);
      expect(h.repo.outbox.get(`${occ?.id}:1`)).toMatchObject({ status: "SKIPPED" });
    });

    it("skips a pending retry once a newer nag for the occurrence exists", async () => {
      const h = harness();
      const reminder = create(h, { strength: "relentless" });
      h.notifier.failNext(1);
      await runAlarm(h);

      h.clock.advance({ minutes: 10 }); // the second nag, before the retry ran
      await runAlarm(h);

      const [occ] = h.repo.listOccurrences(reminder.id);
      expect(h.notifier.sent.map((n) => n.attempt)).toEqual([2]);
      expect(h.repo.outbox.get(`${occ?.id}:1`)).toMatchObject({ status: "SKIPPED" });
    });
  });

  it("supersedes an unacknowledged occurrence and carries its level over", async () => {
    const h = harness();
    const reminder = create(h, { rrule: "FREQ=DAILY" });
    await runNextAlarm(h); // level 0
    await runNextAlarm(h); // level 1
    const [first] = h.repo.listOccurrences(reminder.id);

    h.clock.set(T0.add({ hours: 24 }));
    await runAlarm(h);

    const [second, old] = h.repo.listOccurrences(reminder.id);
    expect(old).toMatchObject({ id: first?.id, state: "MISSED", closeReason: "superseded" });
    expect(h.repo.listEvents(first?.id as string).at(-1)).toMatchObject({
      type: "SUPERSEDED",
      data: { by: second?.id },
    });
    expect(second).toMatchObject({ state: "NAGGING", level: 2, attempts: 1 });
    expect(h.notifier.sent.at(-1)).toMatchObject({
      occurrenceId: second?.id,
      level: 2,
      priority: 4,
    });
  });

  it("starts at level 0 again after an acknowledged occurrence", async () => {
    const h = harness();
    const reminder = create(h, { rrule: "FREQ=DAILY" });
    await runNextAlarm(h);
    await runNextAlarm(h);
    const [first] = h.repo.listOccurrences(reminder.id);
    value(acknowledge(h.deps, first?.id as string));

    await runNextAlarm(h);
    expect(h.repo.listOccurrences(reminder.id)[0]).toMatchObject({ level: 0, attempts: 1 });
  });

  it("only creates the latest due slot after sleeping through several", async () => {
    const h = harness();
    const reminder = create(h, { rrule: "FREQ=DAILY" });
    await runAlarm(h);

    h.clock.set(T0.add({ hours: 74 }));
    await runAlarm(h);

    const occs = h.repo.listOccurrences(reminder.id);
    expect(occs.map((o) => o.scheduledFor.toString())).toEqual([
      "2030-06-13T09:00:00Z",
      "2030-06-10T09:00:00Z",
    ]);
    expect(h.repo.getReminder(reminder.id)?.nextOccurrenceAt?.toString()).toBe(
      "2030-06-14T09:00:00Z",
    );
  });

  it("closes as MISSED(cap) and completes a one-shot reminder", async () => {
    const h = harness();
    const reminder = create(h, { cap: { maxAttempts: 2 } });
    await runNextAlarm(h);
    await runNextAlarm(h);
    await runNextAlarm(h);

    const [occ] = h.repo.listOccurrences(reminder.id);
    expect(occ).toMatchObject({ state: "MISSED", closeReason: "cap", attempts: 2 });
    expect(eventTypes(h, occ?.id as string).at(-1)).toBe("MISSED");
    expect(h.repo.getReminder(reminder.id)?.status).toBe("COMPLETED");
    expect(h.repo.nextWakeAt()).toBeNull();
  });

  it("keeps a recurring reminder ACTIVE when an occurrence reaches its cap", async () => {
    const h = harness();
    const reminder = create(h, { rrule: "FREQ=DAILY", cap: { maxAttempts: 1 } });
    await runNextAlarm(h);
    await runNextAlarm(h);
    expect(h.repo.listOccurrences(reminder.id)[0]?.state).toBe("MISSED");
    expect(h.repo.getReminder(reminder.id)?.status).toBe("ACTIVE");
    expect(h.repo.nextWakeAt()).toEqual(T0.add({ hours: 24 }));
  });

  it("defers a nag inside quiet hours to the window's end, then sends it", async () => {
    const h = harness(T0.add({ hours: 13 })); // 22:00 UTC
    value(updateSettings(h.deps, { quietHours: { start: "21:00", end: "07:00" } }));
    const reminder = create(h, { dtstart: "2030-06-10T23:00" });

    await runNextAlarm(h);
    const [occ] = h.repo.listOccurrences(reminder.id);
    expect(h.notifier.sent).toHaveLength(0);
    expect(h.repo.listEvents(occ?.id as string).at(-1)).toMatchObject({
      type: "DEFERRED_QUIET",
      data: { until: "2030-06-11T07:00:00Z" },
    });
    expect(h.repo.nextWakeAt()?.toString()).toBe("2030-06-11T07:00:00Z");

    await runNextAlarm(h);
    expect(h.notifier.sent).toMatchObject([{ attempt: 1, level: 0 }]);
  });

  it("uses the reminder's current strength and cap for each nag", async () => {
    const h = harness();
    const reminder = create(h, { strength: "gentle" });
    await runNextAlarm(h);
    value(updateReminder(h.deps, reminder.id, { strength: "relentless" }));
    await runNextAlarm(h);
    expect(h.notifier.sent.map((n) => n.priority)).toEqual([3, 4]);
  });

  it("sends nothing for a deleted reminder's pending retry", async () => {
    const h = harness();
    const reminder = create(h);
    h.notifier.failNext(1);
    await runAlarm(h);

    value(deleteReminder(h.deps, reminder.id));
    h.clock.advance({ minutes: 1 });
    await runAlarm(h);

    expect(h.notifier.sent).toHaveLength(0);
    expect(h.repo.nextWakeAt()).toBeNull();
  });

  it("rolls back the whole step when it hits an inconsistency", () => {
    const h = harness();
    create(h); // due now: the step starts its occurrence before reaching the orphan
    h.repo.occurrences.set("orphan", {
      id: "orphan",
      reminderId: "gone",
      scheduledFor: T0.subtract({ hours: 1 }),
      level: 0,
      attempts: 0,
      state: "PENDING",
      nextNagAt: T0.subtract({ hours: 1 }),
      closedAt: null,
      closeReason: null,
    });

    expect(() => processDue(h.deps, T0)).toThrow("has no reminder");
    expect(h.repo.occurrences.size).toBe(1);
    expect(h.repo.events).toHaveLength(0);
  });
});
