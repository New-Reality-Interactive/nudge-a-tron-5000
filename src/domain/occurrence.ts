import { Temporal } from "temporal-polyfill";
import { capDeadline, capReached } from "./cap";
import { intervalAt, maxLevel, priorityAt } from "./escalation";
import { quietHoursEnd } from "./quietHours";
import type {
  Cap,
  EventDraft,
  Occurrence,
  OccurrenceState,
  OpenOccurrence,
  QuietHours,
  Strength,
} from "./types";

/** Everything a due nag needs to decide between MISSED, DEFERRED_QUIET and NAG_SENT. */
export interface NagPolicy {
  strength: Strength;
  /** Already merged with the default (see `effectiveCap`). */
  cap: Cap;
  /** The user's time zone, for quiet hours. */
  timezone: string;
  quietHours: QuietHours | null;
}

export type TransitionInput =
  | { kind: "NAG_DUE"; policy: NagPolicy }
  | { kind: "ACK" }
  | { kind: "SUPERSEDE"; by: string };

export interface Transition {
  occurrence: Occurrence;
  events: EventDraft[];
  nextNagAt: Temporal.Instant | null;
}

export type TransitionErrorCode = "OCCURRENCE_CLOSED" | "NAG_NOT_DUE";

export interface TransitionError {
  code: TransitionErrorCode;
  occurrenceId: string;
  state: OccurrenceState;
  input: TransitionInput["kind"];
}

export type TransitionResult =
  | { ok: true; value: Transition }
  | { ok: false; error: TransitionError };

const ok = (value: Transition): TransitionResult => ({ ok: true, value });

const fail = (
  code: TransitionErrorCode,
  occurrence: Occurrence,
  input: TransitionInput,
): TransitionResult => ({
  ok: false,
  error: { code, occurrenceId: occurrence.id, state: occurrence.state, input: input.kind },
});

const earliest = (a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant =>
  Temporal.Instant.compare(a, b) <= 0 ? a : b;

/** A new PENDING occurrence whose first nag is due at `scheduledFor`. */
export function scheduleOccurrence(params: {
  id: string;
  reminderId: string;
  scheduledFor: Temporal.Instant;
  level: number;
}): Transition {
  const occurrence: OpenOccurrence = {
    ...params,
    attempts: 0,
    state: "PENDING",
    nextNagAt: params.scheduledFor,
    closedAt: null,
    closeReason: null,
  };
  return {
    occurrence,
    events: [
      {
        occurrenceId: params.id,
        type: "SCHEDULED",
        at: params.scheduledFor,
        data: { level: params.level },
      },
    ],
    nextNagAt: occurrence.nextNagAt,
  };
}

/**
 * PENDING → NAGGING → ACKED | MISSED(cap | superseded). Invalid transitions are errors,
 * except ACK on a closed occurrence, which is an idempotent no-op.
 */
export function transition(
  occurrence: Occurrence,
  input: TransitionInput,
  now: Temporal.Instant,
): TransitionResult {
  if (input.kind === "ACK") {
    if (occurrence.nextNagAt === null) {
      return ok({ occurrence, events: [], nextNagAt: null });
    }
    return ok({
      occurrence: {
        ...occurrence,
        state: "ACKED",
        nextNagAt: null,
        closedAt: now,
        closeReason: null,
      },
      events: [{ occurrenceId: occurrence.id, type: "ACKED", at: now, data: {} }],
      nextNagAt: null,
    });
  }

  if (occurrence.nextNagAt === null) return fail("OCCURRENCE_CLOSED", occurrence, input);

  if (input.kind === "SUPERSEDE") {
    return ok({
      occurrence: {
        ...occurrence,
        state: "MISSED",
        nextNagAt: null,
        closedAt: now,
        closeReason: "superseded",
      },
      events: [
        { occurrenceId: occurrence.id, type: "SUPERSEDED", at: now, data: { by: input.by } },
      ],
      nextNagAt: null,
    });
  }

  if (Temporal.Instant.compare(now, occurrence.nextNagAt) < 0) {
    return fail("NAG_NOT_DUE", occurrence, input);
  }
  return ok(nagDue(occurrence, input.policy, now));
}

function nagDue(occurrence: OpenOccurrence, policy: NagPolicy, now: Temporal.Instant): Transition {
  const { strength, cap, timezone, quietHours } = policy;
  const id = occurrence.id;

  if (capReached(occurrence, cap, now)) {
    return {
      occurrence: {
        ...occurrence,
        state: "MISSED",
        nextNagAt: null,
        closedAt: now,
        closeReason: "cap",
      },
      events: [{ occurrenceId: id, type: "MISSED", at: now, data: { reason: "cap" } }],
      nextNagAt: null,
    };
  }

  const deadline = capDeadline(occurrence.scheduledFor, cap);

  const until = quietHours === null ? null : quietHoursEnd(now, timezone, quietHours);
  if (until !== null) {
    const nextNagAt = earliest(until, deadline);
    return {
      occurrence: { ...occurrence, nextNagAt },
      events: [{ occurrenceId: id, type: "DEFERRED_QUIET", at: now, data: { until } }],
      nextNagAt,
    };
  }

  const level =
    occurrence.attempts === 0
      ? occurrence.level
      : Math.min(occurrence.level + 1, maxLevel(strength));
  const attempt = occurrence.attempts + 1;
  const nextNagAt = earliest(now.add(intervalAt(strength, level)), deadline);
  return {
    occurrence: { ...occurrence, state: "NAGGING", level, attempts: attempt, nextNagAt },
    events: [
      {
        occurrenceId: id,
        type: "NAG_SENT",
        at: now,
        data: { attempt, level, priority: priorityAt(strength, level) },
      },
    ],
    nextNagAt,
  };
}
