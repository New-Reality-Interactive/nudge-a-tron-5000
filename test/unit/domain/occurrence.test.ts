import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { maxLevel } from "../../../src/domain/escalation";
import {
  type NagPolicy,
  scheduleOccurrence,
  type Transition,
  type TransitionInput,
  transition,
} from "../../../src/domain/occurrence";
import type { Occurrence } from "../../../src/domain/types";
import {
  PROPERTY_RUNS,
  plainTimeArb,
  strengthArb,
  zonedNearDstArb,
} from "../../support/arbitraries";

const NY = "America/New_York";
const T0 = Temporal.Instant.from("2026-06-10T13:00:00Z"); // 09:00 EDT

const policy = (overrides: Partial<NagPolicy> = {}): NagPolicy => ({
  strength: "firm",
  cap: { maxDurationMinutes: 1440, maxAttempts: 20 },
  timezone: NY,
  quietHours: null,
  ...overrides,
});

const nag = (p: NagPolicy = policy()): TransitionInput => ({ kind: "NAG_DUE", policy: p });

const schedule = (level = 0, scheduledFor = T0) =>
  scheduleOccurrence({ id: "occ-1", reminderId: "rem-1", scheduledFor, level }).occurrence;

/** Applies a transition that must succeed. */
function step(occ: Occurrence, input: TransitionInput, now: Temporal.Instant): Transition {
  const result = transition(occ, input, now);
  if (!result.ok) throw new Error(`unexpected ${result.error.code}`);
  return result.value;
}

/** Sends nags at each due time until the occurrence closes; returns every transition. */
function nagUntilClosed(occ: Occurrence, p: NagPolicy, maxSteps: number): Transition[] {
  const steps: Transition[] = [];
  let current = occ;
  while (current.nextNagAt !== null && steps.length < maxSteps) {
    const t = step(current, nag(p), current.nextNagAt);
    steps.push(t);
    current = t.occurrence;
  }
  return steps;
}

describe("scheduleOccurrence", () => {
  it("creates a PENDING occurrence due at scheduledFor and records SCHEDULED", () => {
    const t = scheduleOccurrence({ id: "occ-1", reminderId: "rem-1", scheduledFor: T0, level: 2 });
    expect(t.occurrence).toMatchObject({ state: "PENDING", level: 2, attempts: 0, nextNagAt: T0 });
    expect(t.nextNagAt).toBe(T0);
    expect(t.events).toEqual([
      { occurrenceId: "occ-1", type: "SCHEDULED", at: T0, data: { level: 2 } },
    ]);
  });
});

describe("transition: NAG_DUE", () => {
  it("sends the first nag at the starting level and moves to NAGGING", () => {
    const t = step(schedule(1), nag(), T0);
    expect(t.occurrence).toMatchObject({ state: "NAGGING", level: 1, attempts: 1 });
    expect(t.events).toEqual([
      {
        occurrenceId: "occ-1",
        type: "NAG_SENT",
        at: T0,
        data: { attempt: 1, level: 1, priority: 3 },
      },
    ]);
    expect(t.nextNagAt?.toString()).toBe("2026-06-10T13:15:00Z"); // firm level 1: 15m
  });

  it("escalates one level per nag, up to maxLevel", () => {
    const steps = nagUntilClosed(schedule(), policy(), 6);
    const sent = steps.flatMap((t) => t.events).filter((e) => e.type === "NAG_SENT");
    expect(sent.map((e) => [e.data.level, e.data.priority])).toEqual([
      [0, 3],
      [1, 3],
      [2, 4],
      [3, 5],
      [3, 5],
      [3, 5],
    ]);
    expect(sent.map((e) => e.at.toString())).toEqual([
      "2026-06-10T13:00:00Z",
      "2026-06-10T13:30:00Z",
      "2026-06-10T13:45:00Z",
      "2026-06-10T13:52:30Z",
      "2026-06-10T13:57:30Z",
      "2026-06-10T14:02:30Z",
    ]);
  });

  it("measures the next interval from `now`, even when the alarm fires late", () => {
    const t = step(schedule(), nag(), T0.add({ minutes: 7 }));
    expect(t.nextNagAt?.toString()).toBe("2026-06-10T13:37:00Z");
  });

  it("rejects a nag before it's due", () => {
    const result = transition(schedule(), nag(), T0.subtract({ seconds: 1 }));
    expect(result).toEqual({
      ok: false,
      error: { code: "NAG_NOT_DUE", occurrenceId: "occ-1", state: "PENDING", input: "NAG_DUE" },
    });
  });

  it("closes as MISSED(cap) at the first due nag after maxAttempts", () => {
    const p = policy({ cap: { maxDurationMinutes: 1440, maxAttempts: 3 } });
    const steps = nagUntilClosed(schedule(), p, 10);
    expect(steps.map((t) => t.events[0]?.type)).toEqual([
      "NAG_SENT",
      "NAG_SENT",
      "NAG_SENT",
      "MISSED",
    ]);
    const last = steps.at(-1) as Transition;
    expect(last.occurrence).toMatchObject({ state: "MISSED", closeReason: "cap", attempts: 3 });
    expect(last.events[0]?.data).toEqual({ reason: "cap" });
    expect(last.nextNagAt).toBeNull();
  });

  it("clamps the next nag to the duration deadline, then closes there", () => {
    const p = policy({ cap: { maxDurationMinutes: 40, maxAttempts: 20 } });
    const steps = nagUntilClosed(schedule(), p, 10);
    expect(steps.map((t) => [t.events[0]?.type, t.events[0]?.at.toString()])).toEqual([
      ["NAG_SENT", "2026-06-10T13:00:00Z"],
      ["NAG_SENT", "2026-06-10T13:30:00Z"],
      ["MISSED", "2026-06-10T13:40:00Z"],
    ]);
  });

  describe("quiet hours", () => {
    const quiet = policy({
      quietHours: {
        start: Temporal.PlainTime.from("08:00"),
        end: Temporal.PlainTime.from("10:00"),
      },
    });

    it("defers without counting an attempt, then sends at the window end", () => {
      const deferred = step(schedule(), nag(quiet), T0);
      expect(deferred.occurrence).toMatchObject({ state: "PENDING", attempts: 0 });
      expect(deferred.events).toEqual([
        {
          occurrenceId: "occ-1",
          type: "DEFERRED_QUIET",
          at: T0,
          data: { until: Temporal.Instant.from("2026-06-10T14:00:00Z") },
        },
      ]);

      const sent = step(deferred.occurrence, nag(quiet), deferred.nextNagAt as Temporal.Instant);
      expect(sent.events[0]).toMatchObject({ type: "NAG_SENT", data: { attempt: 1 } });
    });

    it("clamps a deferral to the duration deadline", () => {
      const p = { ...quiet, cap: { maxDurationMinutes: 30, maxAttempts: 20 } };
      const deferred = step(schedule(), nag(p), T0);
      expect(deferred.nextNagAt?.toString()).toBe("2026-06-10T13:30:00Z");
      const closed = step(deferred.occurrence, nag(p), deferred.nextNagAt as Temporal.Instant);
      expect(closed.occurrence).toMatchObject({ state: "MISSED", closeReason: "cap" });
    });
  });
});

describe("transition: ACK", () => {
  it("closes an open occurrence as ACKED", () => {
    const now = T0.add({ minutes: 5 });
    const t = step(step(schedule(), nag(), T0).occurrence, { kind: "ACK" }, now);
    expect(t.occurrence).toMatchObject({ state: "ACKED", closedAt: now, nextNagAt: null });
    expect(t.events).toEqual([{ occurrenceId: "occ-1", type: "ACKED", at: now, data: {} }]);
  });

  it("acks a PENDING occurrence before its first nag", () => {
    expect(step(schedule(), { kind: "ACK" }, T0).occurrence.state).toBe("ACKED");
  });

  it("is an idempotent no-op on a closed occurrence", () => {
    const acked = step(schedule(), { kind: "ACK" }, T0).occurrence;
    const again = step(acked, { kind: "ACK" }, T0.add({ hours: 1 }));
    expect(again).toEqual({ occurrence: acked, events: [], nextNagAt: null });

    const missed = step(schedule(), { kind: "SUPERSEDE", by: "occ-2" }, T0).occurrence;
    expect(step(missed, { kind: "ACK" }, T0).occurrence).toBe(missed);
  });
});

describe("transition: CANCEL", () => {
  it("closes an open occurrence as CANCELLED", () => {
    const now = T0.add({ minutes: 5 });
    const t = step(step(schedule(), nag(), T0).occurrence, { kind: "CANCEL" }, now);
    expect(t.occurrence).toMatchObject({
      state: "CANCELLED",
      closedAt: now,
      nextNagAt: null,
      closeReason: null,
    });
    expect(t.events).toEqual([{ occurrenceId: "occ-1", type: "CANCELLED", at: now, data: {} }]);
  });

  it("is an idempotent no-op on a closed occurrence", () => {
    const acked = step(schedule(), { kind: "ACK" }, T0).occurrence;
    expect(step(acked, { kind: "CANCEL" }, T0)).toEqual({
      occurrence: acked,
      events: [],
      nextNagAt: null,
    });
    const cancelled = step(schedule(), { kind: "CANCEL" }, T0).occurrence;
    expect(step(cancelled, { kind: "ACK" }, T0).occurrence).toBe(cancelled);
  });
});

describe("transition: SUPERSEDE", () => {
  it("closes an open occurrence as MISSED(superseded)", () => {
    const t = step(schedule(), { kind: "SUPERSEDE", by: "occ-2" }, T0);
    expect(t.occurrence).toMatchObject({ state: "MISSED", closeReason: "superseded" });
    expect(t.events).toEqual([
      { occurrenceId: "occ-1", type: "SUPERSEDED", at: T0, data: { by: "occ-2" } },
    ]);
  });

  it.each([
    ["SUPERSEDE", { kind: "SUPERSEDE", by: "occ-3" }],
    ["NAG_DUE", nag()],
  ] as const)("rejects %s on a closed occurrence", (kind, input) => {
    const closed = step(schedule(), { kind: "ACK" }, T0).occurrence;
    expect(transition(closed, input, T0)).toEqual({
      ok: false,
      error: { code: "OCCURRENCE_CLOSED", occurrenceId: "occ-1", state: "ACKED", input: kind },
    });
  });
});

describe("transition: properties", () => {
  const policyArb = fc.record({
    strength: strengthArb,
    cap: fc.record({
      maxDurationMinutes: fc.oneof(fc.integer({ min: 1, max: 3000 }), fc.constant(1_000_000)),
      maxAttempts: fc.integer({ min: 1, max: 50 }),
    }),
    zoned: zonedNearDstArb,
    quietHours: fc.option(fc.record({ start: plainTimeArb, end: plainTimeArb })),
    level: fc.nat({ max: 5 }),
  });

  it("nagging always reaches MISSED(cap) in a bounded number of steps", () => {
    fc.assert(
      fc.property(policyArb, ({ strength, cap, zoned, quietHours, level }) => {
        const p: NagPolicy = { strength, cap, timezone: zoned.tz, quietHours };
        const occ = schedule(Math.min(level, maxLevel(strength)), zoned.at);
        // Each deferral is followed by a send or the close, so the steps are bounded.
        const bound = 2 * (cap.maxAttempts + 1);
        const steps = nagUntilClosed(occ, p, bound + 1);

        expect(steps.length).toBeLessThanOrEqual(bound);
        const last = steps.at(-1)?.occurrence;
        expect(last).toMatchObject({ state: "MISSED", closeReason: "cap" });
        expect(last?.attempts).toBeLessThanOrEqual(cap.maxAttempts);

        const priorities = steps
          .flatMap((t) => t.events)
          .flatMap((e) => (e.type === "NAG_SENT" ? [e.data.priority] : []));
        expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
      }),
      PROPERTY_RUNS,
    );
  });

  it("random inputs never throw, closed stays closed, and ack or cancel on closed is a no-op", () => {
    const inputArb = fc.constantFrom("nag", "early", "ack", "cancel", "supersede");
    fc.assert(
      fc.property(
        policyArb,
        fc.array(inputArb, { minLength: 1, maxLength: 40 }),
        ({ strength, cap, zoned, quietHours }, inputs) => {
          const p: NagPolicy = { strength, cap, timezone: zoned.tz, quietHours };
          let occ: Occurrence = schedule(0, zoned.at);
          let now = zoned.at;

          for (const kind of inputs) {
            const wasClosed = occ.nextNagAt === null;
            const input: TransitionInput =
              kind === "ack"
                ? { kind: "ACK" }
                : kind === "cancel"
                  ? { kind: "CANCEL" }
                  : kind === "supersede"
                    ? { kind: "SUPERSEDE", by: "next" }
                    : nag(p);
            if (kind === "nag" && occ.nextNagAt !== null) now = occ.nextNagAt;
            const at = kind === "early" ? now.subtract({ seconds: 1 }) : now;
            const result = transition(occ, input, at);

            if (wasClosed) {
              if (kind === "ack" || kind === "cancel") {
                expect(result).toEqual({
                  ok: true,
                  value: { occurrence: occ, events: [], nextNagAt: null },
                });
              } else {
                expect(result).toMatchObject({ ok: false, error: { code: "OCCURRENCE_CLOSED" } });
              }
            }
            if (result.ok) {
              expect(result.value.nextNagAt).toEqual(result.value.occurrence.nextNagAt);
              occ = result.value.occurrence;
            }
          }
        },
      ),
      PROPERTY_RUNS,
    );
  });
});
