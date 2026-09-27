import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { intervalAt, maxLevel, PROFILES, priorityAt } from "../../../src/domain/escalation";
import type { Strength } from "../../../src/domain/types";
import { PROPERTY_RUNS, strengthArb } from "../../support/arbitraries";

const seconds = (s: Strength, level: number) => intervalAt(s, level).total("seconds");
const levels = (s: Strength) => Array.from({ length: maxLevel(s) + 2 }, (_, n) => n);

describe("escalation: pinned profiles (ADR 0005)", () => {
  it.each([
    ["gentle", 4, [3600, 2700, 2025, 1519, 1200, 1200], [3, 3, 3, 3, 4, 4]],
    ["firm", 3, [1800, 900, 450, 300, 300], [3, 3, 4, 5, 5]],
    ["relentless", 3, [600, 300, 150, 120, 120], [4, 4, 4, 5, 5]],
  ] as const)("%s: maxLevel %i, intervals and priorities", (s, max, intervals, priorities) => {
    expect(maxLevel(s)).toBe(max);
    expect(levels(s).map((n) => seconds(s, n))).toEqual(intervals);
    expect(levels(s).map((n) => priorityAt(s, n))).toEqual(priorities);
  });

  it("returns intervals as Temporal durations", () => {
    expect(intervalAt("firm", 0)).toBeInstanceOf(Temporal.Duration);
  });

  it("every profile escalates at least once (maxLevel ≥ 1)", () => {
    for (const s of Object.keys(PROFILES) as Strength[]) expect(maxLevel(s)).toBeGreaterThan(0);
  });
});

describe("escalation: properties", () => {
  const pairArb = fc.record({
    s: strengthArb,
    a: fc.nat({ max: 100 }),
    b: fc.nat({ max: 100 }),
  });

  it("the interval never increases with level and never drops below the floor", () => {
    fc.assert(
      fc.property(pairArb, ({ s, a, b }) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(seconds(s, hi)).toBeLessThanOrEqual(seconds(s, lo));
        expect(seconds(s, hi)).toBeGreaterThanOrEqual(PROFILES[s].floorMinutes * 60);
      }),
      PROPERTY_RUNS,
    );
  });

  it("the priority never decreases with level and stays within the profile's range", () => {
    fc.assert(
      fc.property(pairArb, ({ s, a, b }) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(priorityAt(s, hi)).toBeGreaterThanOrEqual(priorityAt(s, lo));
        expect(priorityAt(s, lo)).toBeGreaterThanOrEqual(PROFILES[s].minPriority);
        expect(priorityAt(s, hi)).toBeLessThanOrEqual(PROFILES[s].maxPriority);
      }),
      PROPERTY_RUNS,
    );
  });

  it("from maxLevel on, the interval is the floor and the priority is the maximum", () => {
    fc.assert(
      fc.property(strengthArb, fc.nat({ max: 100 }), (s, extra) => {
        const n = maxLevel(s) + extra;
        expect(seconds(s, n)).toBe(PROFILES[s].floorMinutes * 60);
        expect(priorityAt(s, n)).toBe(PROFILES[s].maxPriority);
      }),
      PROPERTY_RUNS,
    );
  });
});
