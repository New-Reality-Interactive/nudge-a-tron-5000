/**
 * Limits on RRULEs, so one reminder can't set off an alarm storm (ADR 0008). They're part
 * of the v0 contract: they may be loosened within a major version, never tightened.
 *
 * The 1-minute minimum between occurrences follows from the rule's text alone: with no
 * `SECONDLY` frequency and at most one `BYSECOND` value, every occurrence has the same
 * second-of-minute, so no two can fall within the same minute.
 */
export const RRULE_LIMITS = {
  maxLength: 500,
  maxCount: 1000,
  maxInterval: 1000,
} as const;

/** The frequencies allowed. `SECONDLY` isn't: nothing may repeat faster than a minute. */
export const FREQUENCIES = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

/** RFC 5545 §3.3.10 rule parts. Anything else, including extensions, is rejected. */
const PARTS = new Set([
  "FREQ",
  "UNTIL",
  "COUNT",
  "INTERVAL",
  "BYSECOND",
  "BYMINUTE",
  "BYHOUR",
  "BYDAY",
  "BYMONTHDAY",
  "BYYEARDAY",
  "BYWEEKNO",
  "BYMONTH",
  "BYSETPOS",
  "WKST",
]);

const INTEGER = /^\d+$/;

function inRange(value: string, min: number, max: number): boolean {
  return INTEGER.test(value) && Number(value) >= min && Number(value) <= max;
}

/**
 * Checks an RRULE (without the `RRULE:` prefix) against the limits. Returns the problems
 * found, empty when it passes. Whether the rule is otherwise well formed (e.g. valid
 * `BYDAY` values) is left to the recurrence library when the schedule is parsed.
 */
export function checkRrule(rrule: string): string[] {
  if (rrule.length > RRULE_LIMITS.maxLength) {
    return [`must be at most ${RRULE_LIMITS.maxLength} characters`];
  }

  const parts = new Map<string, string>();
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    const name = eq < 0 ? part : part.slice(0, eq);
    if (eq < 0 || !PARTS.has(name)) return [`unsupported rule part "${name}"`];
    if (parts.has(name)) return [`duplicate rule part "${name}"`];
    parts.set(name, part.slice(eq + 1));
  }

  const problems: string[] = [];
  const freq = parts.get("FREQ");
  if (freq === undefined) {
    problems.push("FREQ is required");
  } else if (!(FREQUENCIES as readonly string[]).includes(freq)) {
    problems.push(`FREQ must be one of ${FREQUENCIES.join(", ")}`);
  }

  const count = parts.get("COUNT");
  if (count !== undefined && !inRange(count, 1, RRULE_LIMITS.maxCount)) {
    problems.push(`COUNT must be an integer from 1 to ${RRULE_LIMITS.maxCount}`);
  }
  if (count !== undefined && parts.has("UNTIL")) {
    problems.push("COUNT and UNTIL can't both be set");
  }

  const interval = parts.get("INTERVAL");
  if (interval !== undefined && !inRange(interval, 1, RRULE_LIMITS.maxInterval)) {
    problems.push(`INTERVAL must be an integer from 1 to ${RRULE_LIMITS.maxInterval}`);
  }

  const bysecond = parts.get("BYSECOND");
  if (bysecond !== undefined && !inRange(bysecond, 0, 59)) {
    problems.push("BYSECOND must be a single second from 0 to 59");
  }

  return problems;
}
