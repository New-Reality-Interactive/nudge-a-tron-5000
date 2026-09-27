# ADR 0005: Escalation, cap and quiet-hours semantics

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

[`docs/architecture.md`](../architecture.md) defines the strength profiles, the safety cap, carry-over and quiet hours, but it leaves several details open. Milestone 2 ([spec](../milestones/02-domain-core.md)) listed them as open questions: how levels are numbered, how levels map to ntfy priorities, what `maxLevel` is, how a quiet-hours end that falls on a DST change resolves, and how durations are stored. While building the domain we also had to decide what happens after `MISSED(cap)`, and whether the default of 100 attempts made sense.

## Decision

**Levels.** Level 0 is the first nag. An occurrence's `level` is the level of its most recent nag, or its starting level before any nag has been sent. Each nag after the first raises the level by 1, up to `maxLevel`. The wait after a nag at level `n` is `max(floor, initial × factor^n)`, rounded to whole seconds.

**`maxLevel`** comes from the profile data, not a separate constant. It's the first level where the interval reaches the floor. Past that level nothing changes, because the interval is already at the floor and the priority is already at its maximum.

| Strength | maxLevel | intervals by level | ntfy priority by level |
|---|---|---|---|
| gentle | 4 | 60, 45, 33.75, 25.3, 20 min | 3, 3, 3, 3, 4 |
| firm | 3 | 30, 15, 7.5, 5 min | 3, 3, 4, 5 |
| relentless | 3 | 10, 5, 2.5, 2 min | 4, 4, 4, 5 |

**Priority.** `priorityAt(n)` goes linearly from the profile's minimum priority at level 0 to its maximum at `maxLevel`, rounded down: `min + floor((max − min) × min(n, maxLevel) / maxLevel)`. Rounding down means the top priority is reserved for nags at the floor interval.

**Cap.**
- The system default is **24 h or 20 attempts**, whichever comes first. The architecture originally said 100 attempts. With 100, `relentless` keeps sending notifications every 2 minutes for about 3.5 hours, and `firm` goes on for about 9 hours. Twenty unanswered notifications already show that the user isn't going to answer. With 20, `gentle` runs for about 8 hours (roughly a working day), `firm` for about 2.3 hours and `relentless` for about 55 minutes.
- Any cap field a reminder leaves unset falls back to the default, so the safety cap always applies.
- After a nag, `nextNagAt` is `min(now + interval, scheduledFor + maxDuration)`. The occurrence closes as `MISSED(cap)` at the next nag that falls due after a limit has been reached. So the last nag still leaves a full interval for the user to acknowledge it.

**Carry-over applies to any unacked close, but only escalates after an ignored nag.**
- A new occurrence starts at level 0 after an ack, or when there is no previous occurrence.
- When the previous occurrence closed without an ack, whether as `MISSED(superseded)` or `MISSED(cap)`, and sent at least one nag, the new one starts at `min(prev.level + 1, maxLevel)`. The architecture only described the supersede case. An occurrence the user let run out without responding is ignored just the same, so the next one should escalate too.
- When the previous occurrence closed without an ack but sent **no** nag, the new one starts at `min(prev.level, maxLevel)`: unchanged. This happens when quiet hours defer an occurrence until it's superseded or reaches the cap deadline. The user had nothing to ignore, so the level shouldn't climb. It shouldn't reset either, because nothing was acknowledged. Without this, an hourly reminder with overnight quiet hours would climb one level per hour through the night and greet the user in the morning at the top priority and shortest interval. (Found in code review.)

**Quiet hours.**
- The window is half-open, `[start, end)`, in the user's local time.
- A window with `start > end` crosses midnight. A window with `start == end` is empty.
- A nag inside the window is deferred to the end of the window. That end is resolved with Temporal's `compatible` disambiguation: an end inside a DST gap moves forward, and an end inside a repeated hour takes its first instance.
- Two exceptions:
  - If the first instance of a repeated hour is not after the nag, the nag happened during the second pass, so the second instance is used.
  - If an end that moved forward because of a gap lands back inside the window, the nag is deferred again. That happens only when the window leaves less free time than the gap, so the night has no free time at all.
- A deferral doesn't count as an attempt. It is also limited by the cap deadline.

**Durations.** Configured durations are stored as whole minutes: `Cap.maxDurationMinutes` and the profile table. That's simple to validate with zod and to store in SQLite. Computed durations are `Temporal.Duration` values rounded to whole seconds. Minutes wouldn't be precise enough for them, because intervals like 7.5 and 25.3 minutes aren't whole minutes.

**State-machine details.**
- `transition` returns a typed `Result`; it never throws.
- An ack on a closed occurrence is a no-op: the occurrence comes back unchanged and no events are recorded.
- A nag or supersede on a closed occurrence is an error (`OCCURRENCE_CLOSED`), and so is a nag before `nextNagAt` (`NAG_NOT_DUE`).
- A supersede records a single `SUPERSEDED` event with the id of the new occurrence. A cap closure records `MISSED` with `{ reason: "cap" }`. The occurrence's `closeReason` tells the two apart.

## Consequences

- The profile table stays the only thing to tune. Changing a profile changes `maxLevel` and the priority steps automatically, and pinned example tests show exactly what changed.
- The lower attempt cap means reminders stop sooner by default. A reminder that needs longer can set its own `maxAttempts`, and M4's validation decides the allowed range.
- `startLevel` needs the previous occurrence's final state, so the Durable Object (M3) must load the most recent closed occurrence of the reminder when it creates the next one.
- `docs/architecture.md` is updated to match: the 20-attempt default, and carry-over after any unacked close.
