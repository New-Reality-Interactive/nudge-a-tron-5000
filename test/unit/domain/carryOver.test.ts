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

  it.each([
    ["superseded", "superseded"],
    ["cap", "cap"],
  ] as const)("carries over one level after MISSED(%s)", (_, closeReason) => {
    const missed = occurrence({
      state: "MISSED",
      level: 1,
      nextNagAt: null,
      closedAt: T0,
      closeReason,
    });
    expect(startLevel(missed, "firm")).toBe(2);
  });

  it("stops at maxLevel", () => {
    const missed = occurrence({ state: "MISSED", level: 3, nextNagAt: null, closedAt: T0 });
    expect(startLevel(missed, "firm")).toBe(maxLevel("firm"));
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
  it("across a chain of occurrences, the level never decreases across unacked closes, never exceeds maxLevel, and resets on ack", () => {
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
          else expect(level).toBeGreaterThanOrEqual(previous.level);

          previous = play(level, strength, outcome === "cap" ? Math.max(nags, 1) : nags, outcome);
          expect(previous.level).toBeLessThanOrEqual(maxLevel(strength));
        }
      }),
      PROPERTY_RUNS,
    );
  });
});
