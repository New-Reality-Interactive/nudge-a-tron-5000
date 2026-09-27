import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { startLevel } from "../../../src/domain/carryOver";
import { maxLevel } from "../../../src/domain/escalation";
import { type NagPolicy, scheduleOccurrence, transition } from "../../../src/domain/occurrence";
import type { Occurrence, Strength } from "../../../src/domain/types";
import { PROPERTY_RUNS, strengthArb } from "../../support/arbitraries";

const T0 = Temporal.Instant.from("2026-06-10T13:00:00Z");

const occurrence = (overrides: Partial<Occurrence>): Occurrence =>
  ({
    ...scheduleOccurrence({ id: "occ-1", reminderId: "rem-1", scheduledFor: T0, level: 0 })
      .occurrence,
    ...overrides,
  }) as Occurrence;

describe("startLevel: examples", () => {
  it("starts at 0 with no previous occurrence", () => {
    expect(startLevel(null, "firm")).toBe(0);
  });

  it("resets to 0 after an ack", () => {
    const acked = occurrence({ state: "ACKED", level: 3, nextNagAt: null, closedAt: T0 });
    expect(startLevel(acked, "firm")).toBe(0);
  });

  it("resets to 0 after a cancel", () => {
    const cancelled = occurrence({ state: "CANCELLED", level: 3, nextNagAt: null, closedAt: T0 });
    expect(startLevel(cancelled, "firm")).toBe(0);
  });

  const missed = (closeReason: "superseded" | "cap", level: number, attempts: number) =>
    occurrence({ state: "MISSED", level, attempts, nextNagAt: null, closedAt: T0, closeReason });

  it.each(["superseded", "cap"] as const)(
    "carries over one level after MISSED(%s) with nags sent",
    (reason) => {
      expect(startLevel(missed(reason, 1, 4), "firm")).toBe(2);
    },
  );

  it.each(["superseded", "cap"] as const)(
    "keeps the level after MISSED(%s) with no nag sent",
    (reason) => {
      expect(startLevel(missed(reason, 2, 0), "firm")).toBe(2);
    },
  );

  it("stops at maxLevel", () => {
    expect(startLevel(missed("superseded", 3, 4), "firm")).toBe(maxLevel("firm"));
  });

  it("clamps a carried level to the new strength's maxLevel", () => {
    // gentle's maxLevel is 4, firm's is 3.
    expect(startLevel(missed("superseded", 4, 0), "firm")).toBe(maxLevel("firm"));
  });

  it("doesn't climb through a night of occurrences deferred by quiet hours", () => {
    let previous: Occurrence = missed("superseded", 1, 3);
    for (let hour = 0; hour < 9; hour++) {
      previous = missed("superseded", startLevel(previous, "firm"), 0);
    }
    expect(previous.level).toBe(2);
  });
});

type Outcome = "ack" | "supersede" | "cap";

/** Runs one occurrence: `nags` nags, then closes it by `outcome`. */
function play(level: number, strength: Strength, nags: number, outcome: Outcome): Occurrence {
  const policy: NagPolicy = {
    strength,
    cap: { maxDurationMinutes: 1_000_000, maxAttempts: outcome === "cap" ? nags : 1_000 },
    timezone: "UTC",
    quietHours: null,
  };
  let occ: Occurrence = scheduleOccurrence({
    id: "occ",
    reminderId: "rem",
    scheduledFor: T0,
    level,
  }).occurrence;
  const run = (input: Parameters<typeof transition>[1]) => {
    const r = transition(occ, input, occ.nextNagAt ?? T0);
    if (!r.ok) throw new Error(r.error.code);
    occ = r.value.occurrence;
  };
  for (let i = 0; i < nags; i++) run({ kind: "NAG_DUE", policy });
  if (outcome === "ack") run({ kind: "ACK" });
  else if (outcome === "supersede") run({ kind: "SUPERSEDE", by: "next" });
  else run({ kind: "NAG_DUE", policy });
  return occ;
}

describe("startLevel: properties", () => {
  it("across a chain of occurrences, the level resets on ack, rises by one only after an ignored nag, and never exceeds maxLevel", () => {
    const chainArb = fc.array(
      fc.record({
        nags: fc.nat({ max: 8 }),
        outcome: fc.constantFrom<Outcome>("ack", "supersede", "cap"),
      }),
      { minLength: 1, maxLength: 25 },
    );

    fc.assert(
      fc.property(strengthArb, chainArb, (strength, chain) => {
        let previous: Occurrence | null = null;
        for (const { nags, outcome } of chain) {
          const level = startLevel(previous, strength);
          expect(level).toBeGreaterThanOrEqual(0);
          expect(level).toBeLessThanOrEqual(maxLevel(strength));
          if (previous === null || previous.state === "ACKED") expect(level).toBe(0);
          else if (previous.attempts === 0) expect(level).toBe(previous.level);
          else expect(level).toBe(Math.min(previous.level + 1, maxLevel(strength)));

          // With outcome "cap" and nags 0, the cap (maxAttempts 0) closes it unsent.
          previous = play(level, strength, nags, outcome);
          expect(previous.level).toBeLessThanOrEqual(maxLevel(strength));
        }
      }),
      PROPERTY_RUNS,
    );
  });
});
