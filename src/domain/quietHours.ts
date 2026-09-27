import { Temporal } from "temporal-polyfill";
import type { QuietHours } from "./types";

const { compare } = Temporal.PlainTime;

/**
 * If `at` falls inside the quiet window (local time in `tz`), the instant the window
 * ends. Otherwise null: the nag isn't deferred.
 *
 * The end is resolved with "compatible" disambiguation: an end in a DST gap moves
 * forward, and an end in a repeated hour takes its first instance. If that first
 * instance isn't after `at` (a nag in the repeated hour's second pass), the later
 * instance is used instead, so the result is always after `at`.
 */
export function quietHoursEnd(
  at: Temporal.Instant,
  tz: string,
  { start, end }: QuietHours,
): Temporal.Instant | null {
  const order = compare(start, end);
  if (order === 0) return null;

  const local = at.toZonedDateTimeISO(tz);
  const time = local.toPlainTime();
  const today = local.toPlainDate();

  let endDate: Temporal.PlainDate;
  if (order < 0) {
    if (compare(time, start) < 0 || compare(time, end) >= 0) return null;
    endDate = today;
  } else if (compare(time, start) >= 0) {
    endDate = today.add({ days: 1 });
  } else if (compare(time, end) < 0) {
    endDate = today;
  } else {
    return null;
  }

  const endLocal = endDate.toPlainDateTime(end);
  let until = endLocal.toZonedDateTime(tz, { disambiguation: "compatible" }).toInstant();
  if (Temporal.Instant.compare(until, at) <= 0) {
    until = endLocal.toZonedDateTime(tz, { disambiguation: "later" }).toInstant();
  }

  // An end shifted forward by a DST gap can land at or past `start` of a window that
  // leaves less than the gap free. That night has no free time, so defer again.
  return quietHoursEnd(until, tz, { start, end }) ?? until;
}
