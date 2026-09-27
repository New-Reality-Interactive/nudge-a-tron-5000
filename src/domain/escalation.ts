import { Temporal } from "temporal-polyfill";
import type { Priority, Strength } from "./types";

/** At level n: interval = max(floor, initial × factor^n). See ADR 0005. */
export interface StrengthProfile {
  initialMinutes: number;
  /** Must be in (0, 1) so the interval reaches the floor. */
  factor: number;
  floorMinutes: number;
  minPriority: Priority;
  maxPriority: Priority;
}

export const PROFILES: Readonly<Record<Strength, Readonly<StrengthProfile>>> = {
  gentle: { initialMinutes: 60, factor: 0.75, floorMinutes: 20, minPriority: 3, maxPriority: 4 },
  firm: { initialMinutes: 30, factor: 0.5, floorMinutes: 5, minPriority: 3, maxPriority: 5 },
  relentless: { initialMinutes: 10, factor: 0.5, floorMinutes: 2, minPriority: 4, maxPriority: 5 },
};

const unflooredMinutes = (p: StrengthProfile, level: number): number =>
  p.initialMinutes * p.factor ** level;

/** The first level whose interval reaches the floor. Escalation stops there. */
export function maxLevel(strength: Strength): number {
  const p = PROFILES[strength];
  let level = 0;
  while (unflooredMinutes(p, level) > p.floorMinutes) level++;
  return level;
}

/** Wait after a nag at `level`, rounded to whole seconds. */
export function intervalAt(strength: Strength, level: number): Temporal.Duration {
  const p = PROFILES[strength];
  const minutes = Math.max(
    p.floorMinutes,
    unflooredMinutes(p, Math.min(level, maxLevel(strength))),
  );
  return Temporal.Duration.from({ seconds: Math.round(minutes * 60) });
}

/**
 * ntfy priority for a nag at `level`: linear from minPriority at level 0 to maxPriority
 * at maxLevel, rounded down, so the top priority is reserved for the floor interval.
 */
export function priorityAt(strength: Strength, level: number): Priority {
  const p = PROFILES[strength];
  const top = maxLevel(strength);
  const step = Math.floor(((p.maxPriority - p.minPriority) * Math.min(level, top)) / top);
  return (p.minPriority + step) as Priority;
}
