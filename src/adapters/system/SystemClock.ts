import { Temporal } from "temporal-polyfill";
import type { Clock } from "../../app/ports";

/**
 * The real time, to the millisecond: storage keeps epoch milliseconds, so finer
 * precision would only make a stored instant differ from the one it was built from.
 */
export class SystemClock implements Clock {
  now(): Temporal.Instant {
    return Temporal.Instant.fromEpochMilliseconds(Date.now());
  }
}
