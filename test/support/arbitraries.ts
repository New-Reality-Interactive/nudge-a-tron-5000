import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import type { Strength } from "../../src/domain/types";

/** Every property runs at least this many cases (spec: "at least a few hundred"). */
export const PROPERTY_RUNS = { numRuns: 300 } as const;

export const TIME_ZONES = [
  "America/New_York",
  "Europe/London",
  "Australia/Sydney",
  "Asia/Kolkata",
] as const;

export const timeZoneArb = fc.constantFrom(...TIME_ZONES);
export const strengthArb = fc.constantFrom<Strength>("gentle", "firm", "relentless");

const toPlainTime = (m: number) => new Temporal.PlainTime(Math.floor(m / 60), m % 60);

/**
 * Any local time on a whole minute, weighted towards 00:00–04:00, where these zones
 * change their clocks, so gap and repeated-hour edge cases come up often.
 */
export const plainTimeArb = fc.oneof(
  fc.integer({ min: 0, max: 24 * 60 - 1 }).map(toPlainTime),
  fc.integer({ min: 0, max: 4 * 60 - 1 }).map(toPlainTime),
);

const RANGE_START = Temporal.Instant.from("2025-01-01T00:00:00Z");
const RANGE_END = Temporal.Instant.from("2028-01-01T00:00:00Z");

/** DST transitions in `tz` between 2025 and 2027 (none for a zone without DST). */
export function dstTransitions(tz: string): Temporal.Instant[] {
  const found: Temporal.Instant[] = [];
  let cursor = RANGE_START.toZonedDateTimeISO(tz).getTimeZoneTransition("next");
  while (cursor !== null && Temporal.Instant.compare(cursor.toInstant(), RANGE_END) < 0) {
    found.push(cursor.toInstant());
    cursor = cursor.getTimeZoneTransition("next");
  }
  return found;
}

const TWO_DAYS = 2 * 24 * 3600;
const THREE_HOURS = 3 * 3600;

/**
 * An instant within two days of a DST transition in `tz`, to the second, and half the
 * time within three hours of it. For a zone without DST, any instant in the range.
 */
export function nearDstArb(tz: string): fc.Arbitrary<Temporal.Instant> {
  const transitions = dstTransitions(tz);
  if (transitions.length === 0) {
    const span = RANGE_START.until(RANGE_END).total("seconds");
    return fc.integer({ min: 0, max: span }).map((s) => RANGE_START.add({ seconds: s }));
  }
  return fc
    .tuple(
      fc.constantFrom(...transitions),
      fc.oneof(
        fc.integer({ min: -TWO_DAYS, max: TWO_DAYS }),
        fc.integer({ min: -THREE_HOURS, max: THREE_HOURS }),
      ),
    )
    .map(([t, s]) => t.add({ seconds: s }));
}

/** A time zone paired with an instant near one of its DST transitions. */
export const zonedNearDstArb = timeZoneArb.chain((tz) => nearDstArb(tz).map((at) => ({ tz, at })));
