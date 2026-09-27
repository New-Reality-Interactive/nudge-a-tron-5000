import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { quietHoursEnd } from "../../../src/domain/quietHours";
import type { QuietHours } from "../../../src/domain/types";
import { PROPERTY_RUNS, plainTimeArb, zonedNearDstArb } from "../../support/arbitraries";

const NY = "America/New_York";
const window = (start: string, end: string): QuietHours => ({
  start: Temporal.PlainTime.from(start),
  end: Temporal.PlainTime.from(end),
});
/** `local` in New York, as an instant. Repeated times take their first instance. */
const ny = (local: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(NY).toInstant();
const deferred = (at: Temporal.Instant, qh: QuietHours) =>
  quietHoursEnd(at, NY, qh)?.toZonedDateTimeISO(NY).toString() ?? null;

describe("quietHoursEnd: examples", () => {
  const sameDay = window("13:00", "15:00");
  const overnight = window("22:00", "07:00");

  it("defers a nag inside a same-day window to its end", () => {
    expect(deferred(ny("2026-06-10T14:00"), sameDay)).toBe(
      "2026-06-10T15:00:00-04:00[America/New_York]",
    );
  });

  it("treats the window as half-open [start, end)", () => {
    expect(deferred(ny("2026-06-10T13:00"), sameDay)).not.toBeNull();
    expect(deferred(ny("2026-06-10T15:00"), sameDay)).toBeNull();
    expect(deferred(ny("2026-06-10T12:59"), sameDay)).toBeNull();
  });

  it("defers to the next morning before midnight in a window that crosses midnight", () => {
    expect(deferred(ny("2026-06-10T23:30"), overnight)).toBe(
      "2026-06-11T07:00:00-04:00[America/New_York]",
    );
  });

  it("defers to the same morning after midnight in a window that crosses midnight", () => {
    expect(deferred(ny("2026-06-11T03:00"), overnight)).toBe(
      "2026-06-11T07:00:00-04:00[America/New_York]",
    );
    expect(deferred(ny("2026-06-11T07:00"), overnight)).toBeNull();
    expect(deferred(ny("2026-06-11T12:00"), overnight)).toBeNull();
  });

  it("never defers with an empty window (start == end)", () => {
    expect(deferred(ny("2026-06-10T14:00"), window("14:00", "14:00"))).toBeNull();
  });

  it("moves an end in a DST gap forward (compatible)", () => {
    // 2026-03-08 02:00 EST → 03:00 EDT, so 02:30 doesn't exist.
    expect(deferred(ny("2026-03-08T01:00"), window("22:00", "02:30"))).toBe(
      "2026-03-08T03:30:00-04:00[America/New_York]",
    );
  });

  it("uses the first instance of a repeated end when it's still ahead", () => {
    // 2026-11-01 02:00 EDT → 01:00 EST, so 01:00–02:00 happens twice.
    expect(deferred(ny("2026-11-01T00:30"), window("00:00", "01:30"))).toBe(
      "2026-11-01T01:30:00-04:00[America/New_York]",
    );
  });

  it("uses the second instance of a repeated end during the repeated hour", () => {
    const at = Temporal.Instant.from("2026-11-01T06:10:00Z"); // 01:10 EST, the second pass
    expect(deferred(at, window("00:00", "01:30"))).toBe(
      "2026-11-01T01:30:00-05:00[America/New_York]",
    );
  });

  it("defers again when a gap-shifted end lands back inside the window", () => {
    // Free time is only [02:30, 03:00), which doesn't exist on 2026-03-08.
    expect(deferred(ny("2026-03-07T23:00"), window("03:00", "02:30"))).toBe(
      "2026-03-09T02:30:00-04:00[America/New_York]",
    );
  });
});

/** Whether a local time is inside the window: an independent statement of the rule. */
function inside(time: Temporal.PlainTime, { start, end }: QuietHours): boolean {
  const cmp = Temporal.PlainTime.compare;
  const order = cmp(start, end);
  if (order === 0) return false;
  if (order < 0) return cmp(time, start) >= 0 && cmp(time, end) < 0;
  return cmp(time, start) >= 0 || cmp(time, end) < 0;
}

describe("quietHoursEnd: properties (all zones, near DST changes)", () => {
  const caseArb = fc.record({
    zoned: zonedNearDstArb,
    qh: fc.record({ start: plainTimeArb, end: plainTimeArb }),
  });

  it("a nag outside the window never moves", () => {
    fc.assert(
      fc.property(caseArb, ({ zoned: { tz, at }, qh }) => {
        fc.pre(!inside(at.toZonedDateTimeISO(tz).toPlainTime(), qh));
        expect(quietHoursEnd(at, tz, qh)).toBeNull();
      }),
      PROPERTY_RUNS,
    );
  });

  it("a deferred nag lands after `at`, within two days, and never strictly inside the window", () => {
    fc.assert(
      fc.property(caseArb, ({ zoned: { tz, at }, qh }) => {
        fc.pre(inside(at.toZonedDateTimeISO(tz).toPlainTime(), qh));
        const until = quietHoursEnd(at, tz, qh);
        expect(until).not.toBeNull();
        if (until === null) return;
        expect(Temporal.Instant.compare(until, at)).toBe(1);
        expect(at.until(until).total("hours")).toBeLessThanOrEqual(48);
        expect(inside(until.toZonedDateTimeISO(tz).toPlainTime(), qh)).toBe(false);
      }),
      // More runs than usual: a window whose free time falls entirely in a DST gap is rare.
      { numRuns: 3000 },
    );
  });
});
