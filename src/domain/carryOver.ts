import { maxLevel } from "./escalation";
import type { Occurrence, Strength } from "./types";

/**
 * Starting level for a new occurrence. After an ack (or with no previous occurrence)
 * it's 0. After any unacked close, MISSED(superseded) or MISSED(cap), it's one level
 * above where the previous occurrence got to, up to `maxLevel`. See ADR 0005.
 */
export function startLevel(previous: Occurrence | null, strength: Strength): number {
  if (previous === null || previous.state === "ACKED") return 0;
  return Math.min(previous.level + 1, maxLevel(strength));
}
