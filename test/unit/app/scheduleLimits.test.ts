import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { checkRrule, FREQUENCIES, RRULE_LIMITS } from "../../../src/app/scheduleLimits";
import { nextOccurrence } from "../../../src/domain/recurrence";
import { PROPERTY_RUNS, zonedNearDstArb } from "../../support/arbitraries";

describe("checkRrule", () => {
  it.each([
    "FREQ=DAILY",
    "FREQ=MINUTELY",
    "FREQ=MINUTELY;BYSECOND=30",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2",
    "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=1000",
    "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;UNTIL=20400101T000000Z",
    "FREQ=HOURLY;BYMINUTE=0,15,30,45;INTERVAL=1000;WKST=SU",
    "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;BYHOUR=9;BYMINUTE=0",
    "FREQ=YEARLY;BYWEEKNO=1;BYYEARDAY=1",
  ])("accepts %s", (rrule) => {
    expect(checkRrule(rrule)).toEqual([]);
  });

  it.each([
    ["FREQ=SECONDLY", /FREQ must be one of/],
    ["FREQ=daily", /FREQ must be one of/],
    ["INTERVAL=1", /FREQ is required/],
    ["FREQ=DAILY;COUNT=1001", /COUNT must be/],
    ["FREQ=DAILY;COUNT=0", /COUNT must be/],
    ["FREQ=DAILY;COUNT=-1", /COUNT must be/],
    ["FREQ=DAILY;COUNT=1.5", /COUNT must be/],
    ["FREQ=DAILY;INTERVAL=0", /INTERVAL must be/],
    ["FREQ=DAILY;INTERVAL=1001", /INTERVAL must be/],
    ["FREQ=MINUTELY;BYSECOND=0,30", /BYSECOND must be a single second/],
    ["FREQ=MINUTELY;BYSECOND=60", /BYSECOND must be a single second/],
    ["FREQ=DAILY;COUNT=2;UNTIL=20400101T000000Z", /COUNT and UNTIL/],
    ["RRULE:FREQ=DAILY", /unsupported rule part "RRULE:FREQ"/],
    ["FREQ=DAILY;DTSTART=20300101T000000", /unsupported rule part "DTSTART"/],
    ["FREQ=DAILY;RSCALE=GREGORIAN", /unsupported rule part "RSCALE"/],
    ["FREQ=DAILY;freq=DAILY", /unsupported rule part "freq"/],
    ["FREQ=DAILY;", /unsupported rule part ""/],
    ["FREQ=DAILY;BYDAY", /unsupported rule part "BYDAY"/],
    ["FREQ=DAILY;FREQ=WEEKLY", /duplicate rule part "FREQ"/],
    [`FREQ=DAILY;BYHOUR=${"1,".repeat(250)}1`, /at most 500 characters/],
  ])("rejects %s", (rrule, problem) => {
    const problems = checkRrule(rrule);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("; ")).toMatch(problem);
  });

  it("reports every problem it finds", () => {
    expect(checkRrule("COUNT=0;INTERVAL=0;BYSECOND=1,2")).toHaveLength(4);
  });

  it("allows exactly the maximum length", () => {
    const rrule = `FREQ=DAILY;BYHOUR=${"1,".repeat(300)}`.slice(0, RRULE_LIMITS.maxLength - 1);
    expect(`${rrule}1`).toHaveLength(RRULE_LIMITS.maxLength);
    expect(checkRrule(`${rrule}1`)).toEqual([]);
  });
});

/** A rule that passes the limits, mixing the parts that can bring occurrences closest. */
const allowedRuleArb = fc
  .record({
    freq: fc.constantFrom(...FREQUENCIES),
    interval: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
    bysecond: fc.option(fc.integer({ min: 0, max: 59 }), { nil: undefined }),
    byminute: fc.option(
      fc.uniqueArray(fc.integer({ min: 0, max: 59 }), { minLength: 1, maxLength: 6 }),
      {
        nil: undefined,
      },
    ),
    byhour: fc.option(
      fc.uniqueArray(fc.integer({ min: 0, max: 23 }), { minLength: 1, maxLength: 4 }),
      {
        nil: undefined,
      },
    ),
  })
  .map(({ freq, interval, bysecond, byminute, byhour }) =>
    [
      `FREQ=${freq}`,
      interval !== undefined ? `INTERVAL=${interval}` : null,
      bysecond !== undefined ? `BYSECOND=${bysecond}` : null,
      byminute !== undefined ? `BYMINUTE=${byminute.join(",")}` : null,
      byhour !== undefined ? `BYHOUR=${byhour.join(",")}` : null,
    ]
      .filter((part) => part !== null)
      .join(";"),
  );

describe("the 1-minute minimum between occurrences", () => {
  it("holds for any rule within the limits, across DST changes", () => {
    fc.assert(
      fc.property(
        allowedRuleArb,
        zonedNearDstArb,
        fc.integer({ min: 0, max: 59 }),
        (rrule, { tz, at }, second) => {
          expect(checkRrule(rrule)).toEqual([]);
          const dtstart = at
            .toZonedDateTimeISO(tz)
            .toPlainDateTime()
            .round({ smallestUnit: "minute", roundingMode: "floor" })
            .with({ second });
          // A dtstart in a DST gap is rejected by validation, so it never gets scheduled.
          fc.pre(isReal(dtstart, tz));

          // A rule that can never match (e.g. every 2 minutes from :59, at minute :00)
          // makes the recurrence library give up and throw, so creating it is rejected.
          fc.pre(schedulable(rrule, dtstart, tz));

          let previous: Temporal.Instant | null = null;
          let after = dtstart.toZonedDateTime(tz).toInstant().subtract({ nanoseconds: 1 });
          for (let i = 0; i < 25; i++) {
            const next = nextOccurrence(rrule, dtstart, tz, after);
            if (next === null) break;
            if (previous !== null) {
              expect(previous.until(next).total("seconds")).toBeGreaterThanOrEqual(60);
            }
            previous = next;
            after = next;
          }
        },
      ),
      PROPERTY_RUNS,
    );
  });
});

/** Whether a local time exists in `tz`: resolving one in a DST gap moves it. */
function isReal(local: Temporal.PlainDateTime, tz: string): boolean {
  return local.toZonedDateTime(tz).toPlainDateTime().equals(local);
}

/** Whether creating the reminder would succeed: the same check `parseSchedule` makes. */
function schedulable(rrule: string, dtstart: Temporal.PlainDateTime, tz: string): boolean {
  try {
    nextOccurrence(rrule, dtstart, tz, Temporal.Instant.fromEpochMilliseconds(0));
    return true;
  } catch {
    return false;
  }
}
