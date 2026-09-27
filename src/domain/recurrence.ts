import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";

/**
 * The first occurrence strictly after `after`, or null when the rule has ended.
 *
 * Expansion happens in wall-clock time in `tz`, then resolves to an instant (RFC 5545):
 * - a repeated local time (DST ends) resolves to its first instance;
 * - a nonexistent local time (DST starts) is skipped, per RFC 5545 §3.3.10.
 *
 * A `dtstart` that itself falls in a DST gap is shifted forward ("compatible"), and
 * rrule-temporal then anchors the whole series at the shifted time. Input validation
 * (Milestone 4) should reject such a `dtstart`.
 *
 * `rrule` null means a one-shot reminder: its only occurrence is `dtstart`.
 */
export function nextOccurrence(
  rrule: string | null,
  dtstart: Temporal.PlainDateTime,
  tz: string,
  after: Temporal.Instant,
): Temporal.Instant | null {
  const start = dtstart.toZonedDateTime(tz, { disambiguation: "compatible" });

  if (rrule === null) {
    const only = start.toInstant();
    return Temporal.Instant.compare(only, after) > 0 ? only : null;
  }

  const rule = new RRuleTemporal({ temporal: Temporal, rruleString: rrule, dtstart: start });
  return rule.next(after.toZonedDateTimeISO(tz))?.toInstant() ?? null;
}

/**
 * The latest occurrence at or before `atOrBefore`, or null when there is none. Used to
 * catch up after the object slept through several slots: only the latest one fires.
 * Same wall-clock and DST semantics as `nextOccurrence`.
 */
export function latestOccurrence(
  rrule: string | null,
  dtstart: Temporal.PlainDateTime,
  tz: string,
  atOrBefore: Temporal.Instant,
): Temporal.Instant | null {
  const start = dtstart.toZonedDateTime(tz, { disambiguation: "compatible" });

  if (rrule === null) {
    const only = start.toInstant();
    return Temporal.Instant.compare(only, atOrBefore) <= 0 ? only : null;
  }

  const rule = new RRuleTemporal({ temporal: Temporal, rruleString: rrule, dtstart: start });
  return rule.previous(atOrBefore.toZonedDateTimeISO(tz), true)?.toInstant() ?? null;
}
