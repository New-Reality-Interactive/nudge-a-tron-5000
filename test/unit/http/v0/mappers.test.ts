import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EventDto, ReminderDto } from "../../../../src/app/dto";
import {
  decodeCursor,
  encodeCursor,
  fromReminderCreate,
  fromReminderPatch,
  toEvent,
  toReminder,
} from "../../../../src/http/v0/mappers";
import { Event, Reminder } from "../../../../src/http/v0/schemas";

const event = (type: EventDto["type"], data: EventDto["data"]): EventDto => ({
  id: "e1",
  occurrenceId: "o1",
  type,
  at: "2030-06-10T09:00:00Z",
  data,
});

describe("cursors", () => {
  it("round-trip any id", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[\x21-\x7e]{1,64}$/), (id) => {
        const cursor = encodeCursor(id) as string;
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeCursor(cursor)).toBe(id);
      }),
    );
    expect(encodeCursor(null)).toBeNull();
  });

  it.each(["!!", "a", "%%%", btoa("\u0001x")])("reject %s", (cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe("toEvent", () => {
  it.each([
    ["SCHEDULED", { level: 1 }],
    ["NAG_SENT", { attempt: 2, level: 1, priority: 4 }],
    ["SEND_FAILED", { attempt: 1, tries: 5, nextTryAt: null }],
    ["SEND_FAILED", { attempt: 1, tries: 1, nextTryAt: "2030-06-10T09:00:30Z" }],
    ["DEFERRED_QUIET", { until: "2030-06-10T07:00:00Z" }],
    ["ACKED", {}],
    ["MISSED", { reason: "cap" }],
    ["SUPERSEDED", { by: "o2" }],
    ["CANCELLED", {}],
  ] as const)("maps %s to its v0 schema", (type, data) => {
    const wire = toEvent(event(type, data));
    expect(wire).toEqual({ ...event(type, data), data });
    expect(Event.safeParse(wire).success).toBe(true);
  });

  it("drops stored fields the v0 schema doesn't have", () => {
    expect(toEvent(event("ACKED", { internal: "x" })).data).toEqual({});
    expect(toEvent(event("SCHEDULED", { level: 0, extra: 1 })).data).toEqual({ level: 0 });
  });

  it("throws on stored data of the wrong shape rather than publishing it", () => {
    expect(() => toEvent(event("SCHEDULED", {}))).toThrow(/level/);
    expect(() => toEvent(event("SUPERSEDED", { by: 3 }))).toThrow(/by/);
  });
});

describe("reminders", () => {
  const dto: ReminderDto = {
    id: "r1",
    title: "t",
    body: null,
    dtstart: "2030-06-10T09:00:00",
    timezone: "UTC",
    rrule: null,
    strength: "firm",
    cap: { maxAttempts: 3 },
    status: "ACTIVE",
    nextOccurrenceAt: null,
    createdAt: "2030-06-10T09:00:00Z",
    updatedAt: "2030-06-10T09:00:00Z",
  };

  it("maps a reminder to the v0 schema", () => {
    expect(Reminder.safeParse(toReminder(dto)).success).toBe(true);
  });

  it("never maps a deleted reminder", () => {
    expect(() => toReminder({ ...dto, status: "DELETED" })).toThrow(/deleted/);
  });

  it("passes only the fields present to the app", () => {
    expect(
      fromReminderCreate({
        title: "t",
        dtstart: "2030-06-10T09:00",
        timezone: "UTC",
        strength: "firm",
        body: undefined,
        rrule: null,
        cap: { maxAttempts: 3, maxDurationMinutes: undefined },
      }),
    ).toEqual({
      title: "t",
      dtstart: "2030-06-10T09:00",
      timezone: "UTC",
      strength: "firm",
      rrule: null,
      cap: { maxAttempts: 3 },
    });
    expect(fromReminderPatch({ title: undefined, body: null, cap: {} })).toEqual({
      body: null,
      cap: {},
    });
  });
});
