# ADR 0006: UserNudger storage, migrations and delivery

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

[ADR 0001](0001-cloudflare-workers-do-per-user.md) puts each user's reminders in one SQLite-backed Durable Object with a single alarm and an outbox. Milestone 3 ([spec](../milestones/03-user-nudger-do.md)) turned that into code and left these open: how the object's schema is migrated, how outbox delivery retries and when it gives up, when recurring occurrences are created, what deleting a reminder does to an open occurrence, and how tests control time.

## Decision

### Schema migrations

- Each migration is a file `migrations/do/NNNN_name.sql`, bundled as a Wrangler Text module (a default module rule, so no `wrangler.jsonc` change), and listed in order in `src/durable/migrations.ts`. A unit test fails if a file isn't listed or the versions have a gap.
- `runMigrations` keeps a `_migrations(version, name, applied_at)` table. It applies every migration above the highest recorded version, **each in its own transaction together with its tracking row**, so a migration is recorded exactly when it has been applied.
- `UserNudger` runs it in its constructor inside `blockConcurrencyWhile`, so no request or alarm sees an old schema. If a migration fails, the error resets the object, and the next request tries again from that migration.
- Migrations are forward-only, like the D1 ones. Never edit one once it's merged.

### Storage

- Tables: `settings` (one row), `reminders`, `occurrences`, `events` (append-only audit log) and `outbox`. Instants are INTEGER epoch milliseconds, so `MIN()`, the indexes and `setAlarm` need no conversion. Partial indexes cover each lookup the alarm makes.
- The production clock has millisecond precision to match, so a stored instant equals the one it was built from.
- Recurring occurrences are created **lazily**. A reminder stores `next_occurrence_at`, and the alarm creates the occurrence when it's due. Nothing is created ahead of time.
- After sleeping through several slots (an outage, or a long gap between wake-ups), the alarm creates **only the latest due slot**. The skipped slots leave no rows. Creating and superseding each of them at once would only add noise, and carry-over wouldn't change, because an occurrence that sent no nag doesn't escalate (ADR 0005).
- A reminder becomes `COMPLETED` when its series has no further slot and its last occurrence has closed. A one-shot reminder whose time has already passed is created `COMPLETED`.

### Deleting a reminder: a new `CANCELLED` state

- Deleting is a soft delete. The reminder becomes `DELETED` and is hidden from queries. It gets no more occurrences, and its open occurrence closes as **`CANCELLED`**, with a `CANCELLED` event and no close reason.
- This adds a `CANCEL` input to M2's state machine. Like `ACK`, it's a no-op on an occurrence that's already closed. `startLevel` treats `CANCELLED` like `ACKED` and resets to level 0, though a deleted reminder never schedules again.
- We rejected `MISSED` with a new `"deleted"` reason, because it would present a deleted reminder as one the user ignored.

### The alarm step and the outbox

1. **In one transaction:**
   - The alarm starts every due occurrence. It supersedes the reminder's open occurrence, takes the starting level from the latest closed one, and advances `next_occurrence_at`.
   - Then it runs every due nag through `transition(NAG_DUE)` with the user's time zone and quiet hours.
   - Each `NAG_SENT` inserts an outbox row keyed `occurrenceId:attempt` with `ON CONFLICT DO NOTHING`.
2. **After the commit,** it delivers every `PENDING` row that's due:
   - A row whose occurrence has closed, or has already sent a newer nag, is marked `SKIPPED`. A retry never nags after an ack, a cancel or a newer nag.
   - On success, the row is marked `SENT`.
   - On failure, it records `SEND_FAILED { attempt, tries, nextTryAt }` and retries after **30 s × 2^(tries−1), capped at 5 min**. After **5 failed tries** it marks the row `DEAD`, and that last event has `nextTryAt: null`.
   - The occurrence carries on regardless, and its next nag goes out on schedule.
   - The delay has no jitter, so tests are deterministic. There's no thundering herd to spread out, because each user has one notifier call at a time.
   - The notifier's error isn't stored or logged, because it could contain the destination (an ntfy topic).
3. **Set the alarm** to `min(next_nag_at, next_occurrence_at, outbox.next_try_at)`, or delete it when nothing is pending. Quiet hours need no separate term, because a deferral already writes the window's end into `next_nag_at`.

Every mutating RPC method reschedules the same way.

**Replays are safe.** A replayed alarm finds nothing due, because the first run already moved `next_nag_at` and `next_occurrence_at`. Its outbox inserts are no-ops, and `SENT` rows are never picked up again.

**One window remains.** If the object dies after the notifier accepted a message but before the row was marked `SENT`, that nag is sent again. At-least-once delivery can't close this gap without an idempotency key at the destination. It's rare, and the consequence is one extra notification.

In M3, the production notifier is `UnconfiguredNotifier`, which fails every send, so rows go `DEAD` rather than pretending to be sent. The ntfy adapter replaces it in M5.

### RPC surface

- `UserNudger`'s public methods are the RPC surface:
  - settings: `getSettings`, `updateSettings`
  - reminders: `createReminder`, `getReminder`, `listReminders`, `updateReminder`, `deleteReminder`
  - `listOccurrences`, `listEvents`
  - `acknowledge`
  - `alarm`
- They take and return plain data. Instants are ISO strings, `dtstart` is a local ISO date-time, and quiet hours are `HH:MM`, because Temporal objects don't survive RPC serialization.
- Expected errors (`NOT_FOUND`, `INVALID`) come back as `AppResult` values, because a thrown error loses its type over RPC.
- `acknowledge` is idempotent. It answers `acked`, or `already_closed` for an occurrence that's already closed.
- Full input validation (zod, RRULE limits) stays at the HTTP boundary in M4. The DO only rejects what would break scheduling.

### How tests control time

- The DO keeps its clock, id generator and notifier in a `deps` field, which the constructor fills with the production set.
- Integration tests replace it through `runInDurableObject`, with a `FakeClock` and a recording `FakeNotifier`, then advance the clock and fire alarms with `runDurableObjectAlarm`.
- Production has no test hook: no test-only method, env flag or code path. RPC exposes only prototype methods, so `deps` can't be reached from outside the object.
- Tests use times in 2030. An alarm set in the past would fire straight away in workerd and race the test.

## Consequences

- Adding a table or column means adding a `migrations/do` file and listing it. Every object runs the new file the first time it wakes after the deploy.
- The use cases run on a synchronous `ReminderRepo` port, because the DO SQL API is synchronous. Unit tests use an in-memory implementation that mirrors the SQLite adapter, so the app layer counts toward coverage. Integration tests cover the real adapter.
- M2's domain gains the `CANCELLED` state and event, `latestOccurrence`, and the wider `SEND_FAILED` data.
- M5 has to supply the real notifier and decide which occurrence data its ack token needs. The outbox payload carries titles only (ADR 0002).
