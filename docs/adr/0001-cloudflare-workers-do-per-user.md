# ADR 0001: Cloudflare Workers with one Durable Object per user

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Nudge-A-Tron 5000 sends nagging reminders. A reminder fires on a schedule, which may recur, and keeps notifying with rising intensity until someone acknowledges it. The service is for a small group (me, family and friends) and has these constraints:

- Hosting should cost about $0.
- Behaviour must be deterministic and reliable. An ack, a scheduled nag and an API edit can arrive at the same moment, and none of them may be lost, duplicated or applied out of order.
- The stack must be a modern async language that works well with GitHub and VS Code and is testable with unit and integration tests.

The options considered were:

1. **Workers + D1 + a cron poller.** A cron trigger scans for due work every minute.
2. **Workers + one Durable Object per reminder.**
3. **Workers + one Durable Object per user.** SQLite-backed, with one alarm per user.
4. **A conventional server** (Node/Go on a VM or container) with Postgres and a job queue.

## Decision

Run the API as a TypeScript Worker (Hono) and give each user one SQLite-backed **`UserNudger` Durable Object**, addressed by `idFromName(userId)`.

- The DO stores that user's reminders, occurrences, audit events and an outbox in its own SQLite database.
- The DO keeps **one alarm**, set to the earliest pending action (next nag, next occurrence, outbox retry, or quiet-hours end). The alarm handler works like a timer wheel.
- D1 holds only global data: `users` and hashed `api_keys`.

## Rationale

- **Determinism.** A DO is single-threaded and its storage is transactional, so an ack, the alarm and an API edit for a user can never race. We get this without writing any locking code.
- **Strong consistency.** Listing and editing a user's reminders is a local SQLite query with no fan-out and no eventual consistency.
- **No polling.** One alarm per user replaces a cron poller. Nags fire when due, not on a minute boundary, and idle users cost nothing.
- **Cost.** Workers Free covers 100k requests/day and includes SQLite-backed DOs and D1. That's far more than family scale needs, and the `*.workers.dev` domain removes domain costs.
- **Tenancy.** Each user's data physically lives in their own DO, so one user can't read another's data, and no query filter is needed to enforce that.

We rejected the cron poller because of its minute-level drift and because it needs its own locking. We rejected per-reminder DOs because listing a user's reminders would have to fan out, and cross-reminder rules (carry-over, quiet hours) would span objects. We rejected a conventional server because it isn't free to run.

## Consequences

- **At-least-once alarms.** Every alarm step must be idempotent. The pattern: in one transaction, advance occurrence state, append events and insert an outbox row with the unique key `occurrenceId:attempt`. After commit, deliver the outbox. Replaying an alarm must never send twice.
- **Vendor coupling.** We're tied to Cloudflare. The domain core stays pure (no I/O and no Workers APIs), so the logic could be ported. Only the adapters and the DO would need rewriting.
- **Two schemas.** D1 migrations (`migrations/d1`) and DO SQLite migrations (`migrations/do`) are versioned separately.
- **Test tooling.** Integration tests run in real workerd through `@cloudflare/vitest-pool-workers`. It pins its own workerd, and that caps `compatibility_date` (currently `2026-08-22`) until the pool is updated.
- **Coverage.** workerd lacks `node:inspector`, so the v8 coverage gate only measures code that the Node `unit` project tests. Workerd-bound code is covered by integration tests, but not counted in the gate.
