# Milestone 2: Domain core

**Status:** Not started
**Depends on:** Milestone 1
**Branch:** `feat/domain-core`

## Goal

Build all the scheduling and nagging rules as pure, deterministic functions. Every later milestone relies on this code to decide *what* happens and *when*. The Durable Object (M3) and the API (M4) only store state and move it around.

## Scope

All of this code lives in `src/domain/`, except the ports, which live in `src/app/`. It does no I/O, uses no Workers APIs, and never reads ambient time or randomness.

1. **Types** (`types.ts`): `Reminder`, `Occurrence`, `Event`, `Strength`, `Cap`, `QuietHours`, `OccurrenceState`, `CloseReason`, `EventType`. They follow the domain model in `docs/architecture.md`. Instants and wall-clock times use Temporal types (`temporal-polyfill`).
2. **Recurrence** (`recurrence.ts`): `nextOccurrence(rrule, dtstart, tz, after)` returns the first occurrence strictly after `after`, or `null` when the rule has ended. It works in wall-clock time, then converts the result to an exact instant. It uses `rrule-temporal` and passes it the `Temporal` object from `temporal-polyfill`. When a time is skipped or repeated because of a DST change, it follows RFC 5545.
3. **Escalation** (`escalation.ts`): the strength profiles, stored as plain data. At level `n`, `interval = max(floor, initial × factor^n)`, and `priorityAt(n)` gives the ntfy priority. Also expose each profile's `maxLevel`.

   | Strength | initial | factor | floor | ntfy priority |
   |---|---|---|---|---|
   | gentle | 60m | 0.75 | 20m | 3 → 4 |
   | firm | 30m | 0.5 | 5m | 3 → 5 |
   | relentless | 10m | 0.5 | 2m | 4 → 5 |

4. **Cap** (`cap.ts`): an occurrence stops when `now − scheduledFor ≥ maxDuration` or `attempts ≥ maxAttempts`, whichever happens first. The system default is 24h / 100 attempts. It applies whenever the reminder doesn't set its own cap.
5. **Quiet hours** (`quietHours.ts`): a nag due inside the user's local quiet window moves to the end of the window. Windows can cross midnight (for example 22:00–07:00). The logic uses time-zone-aware maths, so it's correct across DST changes.
6. **Carry-over** (`carryOver.ts`, or part of the state machine): when a new occurrence fires while the previous one is still unacknowledged, the previous one becomes `MISSED(superseded)`. The new one starts at level `min(prev.level + 1, maxLevel)`. Acknowledging resets the next occurrence to level 0.
7. **Occurrence state machine** (`occurrence.ts`): `PENDING → NAGGING → ACKED | MISSED(cap | superseded)`. Transitions are pure functions of `(state, input, now)`. Each returns the new state, the events to record (`SCHEDULED`, `NAG_SENT`, `DEFERRED_QUIET`, `ACKED`, `MISSED`, `SUPERSEDED`), and `nextNagAt`. An invalid transition is a typed error, not a silent no-op. Acknowledging an already-closed occurrence is idempotent.
8. **Ports** (`src/app/ports.ts`): `Clock` (`now(): Temporal.Instant`) and `IdGenerator`. UUIDv7 is the production implementation; tests use sequential IDs. Include a fixed or advanceable fake clock and a sequential ID generator for tests. They can live in `test/` or `src/app/testing/`.
9. **Remove the spike:** delete `test/integration/spikes/` once `recurrence.ts` has its own tests. Update ADR 0004's "Consequences" to say the spike was removed.

## Out of scope

- Storage, the Durable Object, alarms and the outbox (M3)
- HTTP, zod schemas and RRULE input limits (M4). The domain may assume its input is valid.
- Sending notifications or the ntfy payload format (M5). The domain only produces priority levels.

## Tests

- Add **fast-check** (latest version) as a dev dependency. Unit tests run in Node (`test/unit/domain/…`).
- **Property tests**, each running at least a few hundred cases:
  - *Recurrence:* occurrences strictly increase. `nextOccurrence(…, after)` is always `> after`. The wall-clock time holds across DST changes in several time zones (`America/New_York`, `Europe/London`, `Australia/Sydney`, `Asia/Kolkata`). Leap days behave correctly (for example `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29`).
  - *Escalation:* the interval never increases with level and never drops below the floor. The priority never decreases.
  - *Cap:* for any cap and strength, repeatedly nagging always reaches `MISSED(cap)` in a finite number of steps.
  - *Carry-over:* the level never decreases across supersedes and never goes above `maxLevel`.
  - *Quiet hours:* a deferred nag never lands strictly inside the window, and a nag outside the window never moves. This includes windows that cross midnight and DST-change nights.
- **Example tests** for the specific DST dates, taken over from the spike: 2026-03-08 and 2026-11-01 in `America/New_York`.
- **Coverage:** `src/domain` ≥ 90%, overall ≥ 80% (enforced by `npm run coverage`).

## Acceptance criteria

- [ ] All scope items are implemented with the file layout above, or a layout agreed in the plan
- [ ] Property and example tests pass. `npm run coverage` passes with no lowered thresholds
- [ ] `npm run lint` passes with the determinism rule active. `src/domain` never reads the clock or randomness directly
- [ ] The spike is deleted and ADR 0004 is updated
- [ ] Nothing in `src/domain` imports from `src/app`, `src/adapters`, `src/durable` or `src/http`
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- How are levels numbered: does level 0 mean "first nag"? And how does `priorityAt` map levels to priorities (linear, or a step at a set level)?
- `maxLevel`: is it the level where the interval first reaches its floor, or a fixed number?
- The quiet-hours window is stored as local `PlainTime`s. When the window end falls on a missing DST hour, what happens? (Suggestion: use Temporal's `compatible` disambiguation.)
- Are durations stored as `Temporal.Duration` or as whole minutes?

## Post-merge

- This PR changes `src/**`, so it deploys to staging. Nothing in the Worker's behaviour changes yet. `GET /healthz` should still return `{"status":"ok"}`.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 2: Domain core

Implement `docs/milestones/02-domain-core.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
None required: this is pure TypeScript with no Cloudflare APIs.

## How to start
1. Read `CLAUDE.md`, the milestone spec, `docs/architecture.md`, ADR 0004, the recurrence spike
   in `test/integration/spikes/`, and the determinism lint plugin.
2. Propose a short implementation plan: files, key types and function signatures, the
   property-test list, new dependencies (latest versions, and whether they need install
   scripts), and your answers to the spec's open questions. Wait for my approval before writing
   code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- When implementation is complete, tell me it's ready for `/code-review`. Don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do, and any manual steps.
```
