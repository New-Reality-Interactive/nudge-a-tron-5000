# ADR 0004: Temporal and RRULE for recurrence

- **Status:** Accepted (validated by spike, 2026-09-27)
- **Date:** 2026-09-27

## Context

Reminders recur. "Every day at 09:00 in New York" must fire at 09:00 local time on both sides of a DST change, not drift to 08:00 or 10:00. We also want a standard, well-understood recurrence syntax instead of inventing one.

`Date` doesn't handle IANA time zones correctly. The classic `rrule` package works on `Date` values and is known to have DST problems. The Temporal API models wall-clock times, zones and instants properly.

## Decision

- Express recurrence as an **RFC 5545 RRULE**, with a `dtstart` given as a local date-time plus an IANA time zone.
- Compute occurrences with **[`rrule-temporal`](https://www.npmjs.com/package/rrule-temporal)** over **Temporal**. Work in wall-clock time, then resolve to an instant. DST gaps and overlaps follow RFC 5545 semantics.
- Use **[`temporal-polyfill`](https://www.npmjs.com/package/temporal-polyfill)** as the `Temporal` implementation, and pass it to `rrule-temporal` via its `temporal` option so occurrence values and types come from one implementation.
- The domain function signature will be `nextOccurrence(rrule, dtstart, tz, after)`. It's pure and has no ambient clock (see the determinism lint rule in `src/domain/biome.json`).

## Spike result (Milestone 1)

`test/integration/spikes/rrule-temporal.spike.test.ts` ran inside **workerd** (compat date `2026-08-22`, `nodejs_compat`) via `@cloudflare/vitest-pool-workers`. **It passed.**

| Check | Result |
|---|---|
| Native `Temporal` in workerd | **Absent** (`globalThis.Temporal === undefined`), so `temporal-polyfill` is required and is a runtime dependency |
| `FREQ=DAILY` 09:00 `America/New_York`, 2026-03-06 → 03-10 (DST starts 03-08) | Every occurrence is 09:00 local. Offset changes from −05:00 to −04:00. UTC goes 14:00Z → 13:00Z. The gap across the change is **23 h** |
| Same rule, 2026-10-30 → 11-03 (DST ends 11-01) | Every occurrence is 09:00 local. Offset changes from −04:00 to −05:00. UTC goes 13:00Z → 14:00Z. The gap across the change is **25 h** |
| `next(after)` just after Sat 2026-03-07 09:00 EST | `2026-03-08T09:00:00-04:00[America/New_York]` |
| Bundle cost (probe Worker importing both libraries) | 461 KiB raw / **97 KiB gzip**, compared with 62 KiB / 15 KiB for the Hono-only Worker. Well under the 3 MB Free-plan limit |

No alternative is needed.

## Consequences

- `rrule-temporal` bundles its own copy of the polyfill for internal calendar math, so the polyfill code is shipped twice. That's acceptable at 97 KiB gzip total. We should revisit once workerd ships native Temporal: we'd drop `temporal-polyfill` and pass the native namespace.
- RRULE input needs limits to prevent alarm storms: cap `COUNT`, forbid sub-minute `FREQ`, and require a minimum interval. These are enforced by zod validation in Milestone 4.
- The spike is throwaway. It gets deleted once `src/domain/recurrence.ts` has its own unit and property tests (DST, leap days) in Milestone 2.
