import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../../../src/domain/recurrence";
import { PROPERTY_RUNS, timeZoneArb, zonedNearDstArb } from "../../support/arbitraries";

const NY = "America/New_York";
const pdt = (s: string) => Temporal.PlainDateTime.from(s);
const instant = (s: string) => Temporal.Instant.from(s);

/** The next `count` occurrences strictly after `after`. */
function take(
  rrule: string | null,
  dtstart: Temporal.PlainDateTime,
  tz: string,
  after: Temporal.Instant,
  count: number,
): Temporal.Instant[] {
  const out: Temporal.Instant[] = [];
  let cursor = after;
  while (out.length < count) {
    const next = nextOccurrence(rrule, dtstart, tz, cursor);
    if (next === null) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

const zoned = (xs: Temporal.Instant[], tz: string) =>
  xs.map((x) => x.toZonedDateTimeISO(tz).toString());

describe("nextOccurrence: examples", () => {
  it("keeps 09:00 local across the March transition in New York (2026-03-08)", () => {
    const occ = take("FREQ=DAILY", pdt("2026-03-06T09:00"), NY, instant("2026-03-06T00:00Z"), 5);

    expect(zoned(occ, NY)).toEqual([
      "2026-03-06T09:00:00-05:00[America/New_York]",
      "2026-03-07T09:00:00-05:00[America/New_York]",
      "2026-03-08T09:00:00-04:00[America/New_York]",
      "2026-03-09T09:00:00-04:00[America/New_York]",
      "2026-03-10T09:00:00-04:00[America/New_York]",
    ]);
    expect(occ.map(String)).toEqual([
      "2026-03-06T14:00:00Z",
      "2026-03-07T14:00:00Z",
      "2026-03-08T13:00:00Z",
      "2026-03-09T13:00:00Z",
      "2026-03-10T13:00:00Z",
    ]);
  });

  it("keeps 09:00 local across the November transition in New York (2026-11-01)", () => {
    const occ = take("FREQ=DAILY", pdt("2026-10-30T09:00"), NY, instant("2026-10-30T00:00Z"), 5);

    expect(occ.map(String)).toEqual([
      "2026-10-30T13:00:00Z",
      "2026-10-31T13:00:00Z",
      "2026-11-01T14:00:00Z",
      "2026-11-02T14:00:00Z",
      "2026-11-03T14:00:00Z",
    ]);
    const gaps = occ.slice(1).map((x, i) => (occ[i] as Temporal.Instant).until(x).total("hours"));
    expect(gaps).toEqual([24, 25, 24, 24]);
  });

  it("finds the next occurrence across a transition from an arbitrary instant", () => {
    // 2026-03-07 14:30Z = 09:30 EST, just after Saturday's occurrence.
    const next = nextOccurrence(
      "FREQ=DAILY",
      pdt("2026-01-01T09:00"),
      NY,
      instant("2026-03-07T14:30Z"),
    );
    expect(next?.toZonedDateTimeISO(NY).toString()).toBe(
      "2026-03-08T09:00:00-04:00[America/New_York]",
    );
  });

  it("is strictly after `after`, even when `after` is an occurrence", () => {
    const next = nextOccurrence(
      "FREQ=DAILY",
      pdt("2026-01-01T09:00"),
      NY,
      instant("2026-03-07T14:00Z"),
    );
    expect(next?.toString()).toBe("2026-03-08T13:00:00Z");
  });

  it("returns dtstart when `after` is before it", () => {
    const next = nextOccurrence(
      "FREQ=DAILY",
      pdt("2026-03-06T09:00"),
      NY,
      instant("2020-01-01T00:00Z"),
    );
    expect(next?.toString()).toBe("2026-03-06T14:00:00Z");
  });

  it("skips a local time that doesn't exist (RFC 5545 §3.3.10)", () => {
    const occ = take("FREQ=DAILY", pdt("2026-03-06T02:30"), NY, instant("2026-03-06T00:00Z"), 3);
    expect(zoned(occ, NY)).toEqual([
      "2026-03-06T02:30:00-05:00[America/New_York]",
      "2026-03-07T02:30:00-05:00[America/New_York]",
      "2026-03-09T02:30:00-04:00[America/New_York]",
    ]);
  });

  it("resolves a repeated local time to its first instance", () => {
    const occ = take("FREQ=DAILY", pdt("2026-10-31T01:30"), NY, instant("2026-10-31T00:00Z"), 3);
    expect(zoned(occ, NY)).toEqual([
      "2026-10-31T01:30:00-04:00[America/New_York]",
      "2026-11-01T01:30:00-04:00[America/New_York]",
      "2026-11-02T01:30:00-05:00[America/New_York]",
    ]);
  });

  it("anchors the series at the shifted time when dtstart itself doesn't exist", () => {
    // Documented library behaviour; Milestone 4 validation rejects such a dtstart.
    const occ = take("FREQ=DAILY", pdt("2026-03-08T02:30"), NY, instant("2026-03-01T00:00Z"), 2);
    expect(zoned(occ, NY)).toEqual([
      "2026-03-08T03:30:00-04:00[America/New_York]",
      "2026-03-09T03:30:00-04:00[America/New_York]",
    ]);
  });

  it("only lands on Feb 29 for a leap-day rule", () => {
    const occ = take(
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
      pdt("2024-02-29T09:00"),
      NY,
      instant("2024-01-01T00:00Z"),
      3,
    );
    expect(zoned(occ, NY)).toEqual([
      "2024-02-29T09:00:00-05:00[America/New_York]",
      "2028-02-29T09:00:00-05:00[America/New_York]",
      "2032-02-29T09:00:00-05:00[America/New_York]",
    ]);
  });

  it("returns null once a COUNT rule has ended", () => {
    const occ = take(
      "FREQ=DAILY;COUNT=2",
      pdt("2026-03-06T09:00"),
      NY,
      instant("2026-01-01T00:00Z"),
      5,
    );
    expect(occ).toHaveLength(2);
  });

  describe("one-shot (no rrule)", () => {
    const dtstart = pdt("2026-03-06T09:00");

    it("returns dtstart while it's in the future", () => {
      expect(nextOccurrence(null, dtstart, NY, instant("2026-03-06T13:59Z"))?.toString()).toBe(
        "2026-03-06T14:00:00Z",
      );
    });

    it("returns null at or after dtstart", () => {
      expect(nextOccurrence(null, dtstart, NY, instant("2026-03-06T14:00Z"))).toBeNull();
    });
  });
});

const RULES = [
  "FREQ=DAILY",
  "FREQ=DAILY;INTERVAL=3",
  "FREQ=WEEKLY;BYDAY=MO,WE,SA",
  "FREQ=HOURLY;INTERVAL=5",
  "FREQ=MONTHLY;BYMONTHDAY=31",
  "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
];

/** A local start time a few days before `at`, on a whole minute. */
const dtstartBefore = (at: Temporal.Instant, tz: string) =>
  fc
    .record({ days: fc.integer({ min: 1, max: 20 }), minute: fc.integer({ min: 0, max: 1439 }) })
    .map(({ days, minute }) =>
      at
        .toZonedDateTimeISO(tz)
        .toPlainDate()
        .subtract({ days })
        .toPlainDateTime(new Temporal.PlainTime(Math.floor(minute / 60), minute % 60)),
    );

/** True when `local` exists in `tz`, i.e. it isn't in a DST gap. */
const exists = (local: Temporal.PlainDateTime, tz: string) =>
  local.toZonedDateTime(tz, { disambiguation: "compatible" }).toPlainDateTime().equals(local);

describe("nextOccurrence: properties", () => {
  it("is strictly after `after`, and successive occurrences strictly increase", () => {
    fc.assert(
      fc.property(
        zonedNearDstArb.chain(({ tz, at }) =>
          fc.record({
            tz: fc.constant(tz),
            after: fc.constant(at),
            dtstart: dtstartBefore(at, tz),
            rrule: fc.constantFrom(...RULES),
          }),
        ),
        ({ tz, after, dtstart, rrule }) => {
          const occ = take(rrule, dtstart, tz, after, 4);
          let previous = after;
          for (const x of occ) {
            expect(Temporal.Instant.compare(x, previous)).toBe(1);
            previous = x;
          }
        },
      ),
      PROPERTY_RUNS,
    );
  });

  it("keeps dtstart's wall-clock time for daily and weekly rules across DST changes", () => {
    fc.assert(
      fc.property(
        zonedNearDstArb.chain(({ tz, at }) =>
          fc.record({
            tz: fc.constant(tz),
            after: fc.constant(at),
            dtstart: dtstartBefore(at, tz),
            rrule: fc.constantFrom("FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE,SA"),
          }),
        ),
        ({ tz, after, dtstart, rrule }) => {
          fc.pre(exists(dtstart, tz));
          const occ = take(rrule, dtstart, tz, after, 8);
          expect(occ).toHaveLength(8);
          for (const x of occ) {
            expect(x.toZonedDateTimeISO(tz).toPlainTime().equals(dtstart.toPlainTime())).toBe(true);
          }
        },
      ),
      PROPERTY_RUNS,
    );
  });

  it("puts every leap-day occurrence on Feb 29 of a leap year", () => {
    fc.assert(
      fc.property(
        timeZoneArb,
        fc.integer({ min: 2000, max: 2090 }),
        fc.integer({ min: 0, max: 1439 }),
        (tz, year, minute) => {
          const dtstart = new Temporal.PlainDateTime(
            2000,
            2,
            29,
            Math.floor(minute / 60),
            minute % 60,
          );
          const after = new Temporal.PlainDate(year, 1, 1).toZonedDateTime(tz).toInstant();
          const occ = take("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", dtstart, tz, after, 2);
          expect(occ).toHaveLength(2);
          for (const x of occ) {
            const local = x.toZonedDateTimeISO(tz);
            expect([local.month, local.day, local.inLeapYear]).toEqual([2, 29, true]);
          }
        },
      ),
      PROPERTY_RUNS,
    );
  });
});
