import { Temporal } from "temporal-polyfill";
import type { Cap, Occurrence } from "./types";

/** The system-wide safety cap. See ADR 0005 for why 20 attempts. */
export const DEFAULT_CAP: Readonly<Cap> = { maxDurationMinutes: 24 * 60, maxAttempts: 20 };

/** Fills each field the reminder leaves unset from `DEFAULT_CAP`. */
export function effectiveCap(cap: Partial<Cap>): Cap {
  return {
    maxDurationMinutes: cap.maxDurationMinutes ?? DEFAULT_CAP.maxDurationMinutes,
    maxAttempts: cap.maxAttempts ?? DEFAULT_CAP.maxAttempts,
  };
}

/** The instant at which the duration limit is reached. */
export function capDeadline(scheduledFor: Temporal.Instant, cap: Cap): Temporal.Instant {
  return scheduledFor.add({ minutes: cap.maxDurationMinutes });
}

/** True once `now − scheduledFor ≥ maxDuration` or `attempts ≥ maxAttempts`. */
export function capReached(
  occurrence: Pick<Occurrence, "scheduledFor" | "attempts">,
  cap: Cap,
  now: Temporal.Instant,
): boolean {
  return (
    occurrence.attempts >= cap.maxAttempts ||
    Temporal.Instant.compare(now, capDeadline(occurrence.scheduledFor, cap)) >= 0
  );
}
