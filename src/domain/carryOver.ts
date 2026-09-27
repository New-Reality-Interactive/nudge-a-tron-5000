import { maxLevel } from "./escalation";
import type { Occurrence, Strength } from "./types";

/**
 * Starting level for a new occurrence. After an ack or a cancel (or with no previous
 * occurrence) it's 0. After an unacked close, MISSED(superseded) or MISSED(cap), it's one level
 * above where the previous occurrence got to, up to `maxLevel`, but only if that
 * occurrence sent a nag. One that sent none (e.g. deferred by quiet hours until it was
 * superseded) gave the user nothing to ignore, so its level passes on unchanged.
 * See ADR 0005.
 */
export function startLevel(previous: Occurrence | null, strength: Strength): number {
  if (previous === null || previous.state === "ACKED" || previous.state === "CANCELLED") return 0;
  const escalation = previous.attempts > 0 ? 1 : 0;
  return Math.min(previous.level + escalation, maxLevel(strength));
}
