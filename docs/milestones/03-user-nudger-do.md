# Milestone 3: UserNudger Durable Object

**Status:** Not started
**Depends on:** Milestone 2
**Branch:** `feat/user-nudger-do`

## Goal

Make the Durable Object that runs each user's reminders reliable. It stores reminders and their occurrences in its own SQLite database. It keeps a single alarm, processes whatever is due in one transaction, and hands notifications to a `Notifier` through an outbox. Replaying an alarm must never send a duplicate. This milestone is where [ADR 0001](../adr/0001-cloudflare-workers-do-per-user.md) turns into working code.

## Scope

1. **DO SQLite schema** for `reminders`, `occurrences`, `events` and `outbox`. The outbox has a unique key `occurrenceId:attempt`. Add indexes for the alarm's lookups, such as the next `nextNagAt` and the next pending outbox row.
2. **DO schema migrations.** Build a mechanism inside `UserNudger` that runs versioned SQL from `migrations/do/` exactly once per object, before the object serves any request. Use `ctx.blockConcurrencyWhile` in the constructor, and track versions in a `_migrations` table (or similar). This is separate from the D1 migrations. Propose the design in the plan. If it's significant, record it as an ADR.
3. **Repository adapter** (`src/adapters/do/SqliteReminderRepo.ts`): implements the `ReminderRepo` port from `src/app` on top of `ctx.storage.sql`.
4. **Use cases** in `src/app`, which use the domain functions from M2 and the ports:
   - create, update, delete and list reminders
   - list occurrences, and list events for an occurrence
   - acknowledge an occurrence
   - process due work (the alarm step)
5. **`UserNudger` RPC methods** that the HTTP layer (M4) and the ack route (M5) will call. The DO subclasses `DurableObject`, so its public methods can be called directly over RPC.
6. **Single alarm.** After every change, call `setAlarm(min(nextNagAt, nextOccurrenceAt, outbox.nextTryAt, quietHoursEnd))`, or `deleteAlarm()` when nothing is pending.
7. **Alarm step,** which must be idempotent because alarms fire at least once:
   1. In one transaction: advance the state of each due occurrence, append its events, and insert its outbox rows. A duplicate outbox key does nothing.
   2. After the commit, deliver the pending outbox rows through the `Notifier` port. On success, mark the row sent. On failure, increment `tries`, set `nextTryAt` with backoff, and record a `SEND_FAILED` event.
   3. Set the next alarm.
8. **`Notifier` port** in `src/app`, plus a fake adapter for tests that records every send. The real ntfy adapter comes in M5.
9. **User settings in the DO:** timezone and quiet hours, needed for M2's quiet-hours rule. They're set through an RPC method for now; M4 adds `PATCH /v1/me` on top of it.

## Out of scope

- HTTP routes, auth and D1 (M4)
- Ack tokens, the ntfy adapter and the ack confirm page (M5)
- Rate limiting and logging polish (M6)

## Tests

These are integration tests (`test/integration/…`) running in workerd:
- **Isolation:** use `runInDurableObject` to call the DO's methods, and `runDurableObjectAlarm` to trigger the alarm.
- **Controlled time:** the DO gets its time from a `Clock`. Tests must be able to control that clock, for example with a test-only way to set the time, or through `Env`. Propose the approach in the plan. The tests must not depend on the real clock.
- **Scenarios:**
  - Create a reminder. The alarm is set to its first occurrence.
  - Run the alarm repeatedly. The fake notifier gets the escalating sequence (intervals and priorities from M2).
  - Acknowledge mid-sequence. The next alarm sends nothing for that occurrence.
  - **Replay:** run the same alarm twice. It sends nothing extra and writes no duplicate events.
  - Delivery fails, then succeeds. There's one `SEND_FAILED` event, a retry after backoff, then exactly one send.
  - Supersede: an unacknowledged occurrence becomes `MISSED(superseded)` when the next one fires, and its level carries over.
  - The cap is reached and the occurrence becomes `MISSED(cap)`. Quiet hours defer a nag and record a `DEFERRED_QUIET` event.
  - Migrations: a fresh object runs them all. An object at an older version runs only the new ones. Running again does nothing.
- Logic that doesn't need workerd (the use cases with in-memory fakes) should also get **unit** tests, so it counts toward coverage.

## Acceptance criteria

- [ ] The schema, the DO migration mechanism and the repository are in place. The migration design is documented (as an ADR if significant)
- [ ] The alarm step is idempotent, and the replay test proves it
- [ ] Outbox retry uses backoff and records `SEND_FAILED`
- [ ] The integration scenarios above pass. `npm run coverage` passes
- [ ] The `UserNudger` RPC surface is ready for M4 and M5 to use
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- How do tests control the time? What is the test-only way to set it, and how is it kept out of production builds?
- What are the outbox backoff schedule and the maximum number of tries? What happens after the last try: record a `SEND_FAILED` event and mark the row dead?
- How are recurring occurrences created: only when due (lazily), or a set number ahead of time?
- A reminder is deleted while it has an open occurrence: close the occurrence (with what reason?) or leave it?

## Post-merge

- This PR deploys to staging. Existing Durable Objects run the new migrations the first time they wake. At this point only test objects exist.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 3: UserNudger Durable Object

Implement `docs/milestones/03-user-nudger-do.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
Load `cloudflare:durable-objects` and `cloudflare:wrangler` before planning.

## How to start
1. Read `CLAUDE.md`, the milestone spec, `docs/architecture.md`, ADR 0001, the domain code in
   `src/domain`, the ports in `src/app`, and `src/durable/UserNudger.ts`.
2. Propose a short implementation plan: the schema, the DO migration mechanism, the RPC
   surface, the alarm and outbox flow, how tests control time, new dependencies, and your
   answers to the spec's open questions. Wait for my approval before writing code.

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
