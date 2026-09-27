import { describe, expect, it } from "vitest";
import { acknowledge, listEvents, listOccurrences } from "../../../src/app/occurrences";
import {
  createReminder,
  deleteReminder,
  getReminder,
  listReminders,
  updateReminder,
} from "../../../src/app/reminders";
import { create, eventTypes, harness, reminderInput, runAlarm, T0, value } from "./harness";

describe("createReminder", () => {
  it("stores the reminder with its first occurrence at or after now", () => {
    const h = harness();
    const r = create(h, { body: "Green bin", rrule: "FREQ=DAILY", cap: { maxAttempts: 5 } });
    expect(r).toEqual({
      id: "id-000001",
      title: "Take the bins out",
      body: "Green bin",
      dtstart: "2030-06-10T09:00:00",
      timezone: "UTC",
      rrule: "FREQ=DAILY",
      strength: "firm",
      cap: { maxAttempts: 5 },
      status: "ACTIVE",
      nextOccurrenceAt: "2030-06-10T09:00:00Z",
      createdAt: "2030-06-10T09:00:00Z",
      updatedAt: "2030-06-10T09:00:00Z",
    });
  });

  it("starts a recurring series at its next slot when dtstart has passed", () => {
    const h = harness(T0.add({ minutes: 1 }));
    expect(create(h, { rrule: "FREQ=DAILY" }).nextOccurrenceAt).toBe("2030-06-11T09:00:00Z");
  });

  it("creates a one-shot whose time has passed as COMPLETED", () => {
    const h = harness(T0.add({ minutes: 1 }));
    const r = create(h);
    expect(r).toMatchObject({ status: "COMPLETED", nextOccurrenceAt: null, body: null });
    expect(h.repo.nextWakeAt()).toBeNull();
  });

  it.each([
    ["dtstart", { dtstart: "not a date" }],
    ["time zone", { timezone: "Mars/Olympus_Mons" }],
    ["rrule", { rrule: "FREQ=SOMETIMES" }],
  ])("rejects an invalid %s", (_, overrides) => {
    const h = harness();
    const result = createReminder(h.deps, reminderInput(overrides));
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(h.repo.reminders.size).toBe(0);
  });
});

describe("getReminder and listReminders", () => {
  it("returns live reminders and hides deleted ones", () => {
    const h = harness();
    const a = create(h, { title: "a" });
    const b = create(h, { title: "b" });
    value(deleteReminder(h.deps, a.id));

    expect(listReminders(h.deps).map((r) => r.title)).toEqual(["b"]);
    expect(value(getReminder(h.deps, b.id)).title).toBe("b");
    expect(getReminder(h.deps, a.id)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(getReminder(h.deps, "nope")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("updateReminder", () => {
  it("changes only the fields given, and clears the body with null", () => {
    const h = harness();
    const r = create(h, { body: "Green bin", cap: { maxAttempts: 5 } });
    h.clock.advance({ minutes: 1 });

    const updated = value(
      updateReminder(h.deps, r.id, { title: "Bins!", body: null, cap: { maxDurationMinutes: 60 } }),
    );
    expect(updated).toEqual({
      ...r,
      title: "Bins!",
      body: null,
      cap: { maxDurationMinutes: 60 },
      updatedAt: "2030-06-10T09:01:00Z",
    });

    expect(value(updateReminder(h.deps, r.id, { body: "Blue bin" })).body).toBe("Blue bin");
    expect(value(updateReminder(h.deps, r.id, {})).body).toBe("Blue bin");
  });

  it("moves the next occurrence when the schedule changes", () => {
    const h = harness(T0.subtract({ hours: 1 }));
    const r = create(h);
    const updated = value(
      updateReminder(h.deps, r.id, { dtstart: "2030-06-10T08:30", rrule: "FREQ=HOURLY" }),
    );
    expect(updated).toMatchObject({ status: "ACTIVE", nextOccurrenceAt: "2030-06-10T08:30:00Z" });
    expect(h.repo.nextWakeAt()?.toString()).toBe("2030-06-10T08:30:00Z");

    const moved = value(updateReminder(h.deps, r.id, { timezone: "America/New_York" }));
    expect(moved.nextOccurrenceAt).toBe("2030-06-10T12:30:00Z");
  });

  it("completes a reminder whose new schedule has no future slot and nothing open", () => {
    const h = harness();
    const r = create(h, { dtstart: "2030-06-11T09:00" });
    const updated = value(updateReminder(h.deps, r.id, { dtstart: "2030-06-01T09:00" }));
    expect(updated).toMatchObject({ status: "COMPLETED", nextOccurrenceAt: null });
  });

  it("keeps a reminder ACTIVE while its occurrence is still open", async () => {
    const h = harness();
    const r = create(h);
    await runAlarm(h);
    const updated = value(updateReminder(h.deps, r.id, { dtstart: "2030-06-01T09:00" }));
    expect(updated).toMatchObject({ status: "ACTIVE", nextOccurrenceAt: null });
  });

  it("rejects an invalid schedule and changes nothing", () => {
    const h = harness();
    const r = create(h);
    expect(updateReminder(h.deps, r.id, { title: "x", rrule: "FREQ=NEVER" })).toMatchObject({
      ok: false,
      error: { code: "INVALID" },
    });
    expect(value(getReminder(h.deps, r.id))).toEqual(r);
  });

  it("returns NOT_FOUND for a missing or deleted reminder", () => {
    const h = harness();
    const r = create(h);
    value(deleteReminder(h.deps, r.id));
    for (const id of [r.id, "nope"]) {
      expect(updateReminder(h.deps, id, { title: "x" })).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    }
  });
});

describe("deleteReminder", () => {
  it("cancels the open occurrence and stops scheduling", async () => {
    const h = harness();
    const r = create(h, { rrule: "FREQ=DAILY" });
    await runAlarm(h);
    const [occ] = h.repo.listOccurrences(r.id);

    value(deleteReminder(h.deps, r.id));

    expect(h.repo.getReminder(r.id)).toMatchObject({ status: "DELETED", nextOccurrenceAt: null });
    expect(h.repo.getOccurrence(occ?.id as string)).toMatchObject({
      state: "CANCELLED",
      closedAt: T0,
    });
    expect(eventTypes(h, occ?.id as string).at(-1)).toBe("CANCELLED");
    expect(h.repo.nextWakeAt()).toBeNull();
    expect(deleteReminder(h.deps, r.id)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("deletes a reminder with no occurrences yet", () => {
    const h = harness(T0.subtract({ hours: 1 }));
    const r = create(h);
    expect(deleteReminder(h.deps, r.id)).toEqual({ ok: true, value: null });
    expect(h.repo.occurrences.size).toBe(0);
  });
});

describe("occurrence queries and acknowledge", () => {
  it("lists occurrences newest first and events oldest first", async () => {
    const h = harness();
    const r = create(h, { rrule: "FREQ=DAILY" });
    await runAlarm(h);
    h.clock.advance({ hours: 24 });
    await runAlarm(h);

    const occs = value(listOccurrences(h.deps, r.id));
    expect(occs.map((o) => [o.scheduledFor, o.state])).toEqual([
      ["2030-06-11T09:00:00Z", "NAGGING"],
      ["2030-06-10T09:00:00Z", "MISSED"],
    ]);
    const events = value(listEvents(h.deps, occs[1]?.id as string));
    expect(events.map((e) => e.type)).toEqual(["SCHEDULED", "NAG_SENT", "SUPERSEDED"]);
    expect(events[1]).toMatchObject({
      at: "2030-06-10T09:00:00Z",
      data: { attempt: 1, level: 0, priority: 3 },
    });
  });

  it("returns NOT_FOUND for unknown or deleted parents", () => {
    const h = harness();
    const r = create(h);
    value(deleteReminder(h.deps, r.id));
    expect(listOccurrences(h.deps, r.id)).toMatchObject({ ok: false });
    expect(listOccurrences(h.deps, "nope")).toMatchObject({ ok: false });
    expect(listEvents(h.deps, "nope")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(acknowledge(h.deps, "nope")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("acknowledges once, then reports already_closed without new events", async () => {
    const h = harness();
    const r = create(h);
    await runAlarm(h);
    const [occ] = h.repo.listOccurrences(r.id);
    const id = occ?.id as string;
    h.clock.advance({ minutes: 3 });

    const first = value(acknowledge(h.deps, id));
    expect(first).toMatchObject({
      outcome: "acked",
      occurrence: { state: "ACKED", closedAt: "2030-06-10T09:03:00Z", nextNagAt: null },
    });
    const events = h.repo.events.length;

    expect(value(acknowledge(h.deps, id))).toEqual({ ...first, outcome: "already_closed" });
    expect(h.repo.events).toHaveLength(events);
  });

  it("completes a one-shot reminder when its occurrence is acknowledged", async () => {
    const h = harness();
    const r = create(h);
    await runAlarm(h);
    value(acknowledge(h.deps, h.repo.listOccurrences(r.id)[0]?.id as string));
    expect(h.repo.getReminder(r.id)?.status).toBe("COMPLETED");
  });

  it("keeps a recurring reminder ACTIVE when an occurrence is acknowledged", async () => {
    const h = harness();
    const r = create(h, { rrule: "FREQ=DAILY" });
    await runAlarm(h);
    value(acknowledge(h.deps, h.repo.listOccurrences(r.id)[0]?.id as string));
    expect(h.repo.getReminder(r.id)?.status).toBe("ACTIVE");
  });
});
