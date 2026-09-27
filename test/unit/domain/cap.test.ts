import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { capDeadline, capReached, DEFAULT_CAP, effectiveCap } from "../../../src/domain/cap";

const scheduledFor = Temporal.Instant.from("2026-03-06T14:00:00Z");
const cap = { maxDurationMinutes: 60, maxAttempts: 5 };

describe("cap", () => {
  it("defaults to 24h / 20 attempts", () => {
    expect(DEFAULT_CAP).toEqual({ maxDurationMinutes: 1440, maxAttempts: 20 });
    expect(effectiveCap({})).toEqual(DEFAULT_CAP);
  });

  it("fills each unset field from the default", () => {
    expect(effectiveCap({ maxAttempts: 3 })).toEqual({ maxDurationMinutes: 1440, maxAttempts: 3 });
    expect(effectiveCap({ maxDurationMinutes: 90 })).toEqual({
      maxDurationMinutes: 90,
      maxAttempts: 20,
    });
    expect(effectiveCap(cap)).toEqual(cap);
  });

  it("puts the deadline maxDuration after scheduledFor", () => {
    expect(capDeadline(scheduledFor, cap).toString()).toBe("2026-03-06T15:00:00Z");
  });

  it("is reached once now − scheduledFor ≥ maxDuration", () => {
    const occ = { scheduledFor, attempts: 0 };
    expect(capReached(occ, cap, scheduledFor.add({ minutes: 59, seconds: 59 }))).toBe(false);
    expect(capReached(occ, cap, scheduledFor.add({ minutes: 60 }))).toBe(true);
  });

  it("is reached once attempts ≥ maxAttempts", () => {
    expect(capReached({ scheduledFor, attempts: 4 }, cap, scheduledFor)).toBe(false);
    expect(capReached({ scheduledFor, attempts: 5 }, cap, scheduledFor)).toBe(true);
  });
});
