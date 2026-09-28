# Nudge-A-Tron 5000 — MVP Architecture & Plan

> **Status:** approved (2026-09-27). This is the source of truth for the stack, repo layout and tooling. Individual decisions are recorded as ADRs in [`adr/`](adr/).

## Context
Greenfield service for **nagging reminders**: a reminder fires on a (possibly recurring) schedule and keeps notifying, with escalating intensity, until it's acknowledged. Constraints: ~$0 cost, GitHub + VS Code, modern async language, pluggable datasources/messaging, and a secure, reliable, deterministic system with unit and integration tests.

**Decisions from Q&A**
| Topic | Decision |
|---|---|
| Audience | Me + family/friends (small multi-user) |
| Runtime | TypeScript on Cloudflare Workers + Durable Objects (free tier) |
| Channel | ntfy.sh push first, behind a `Notifier` port. SMS (Twilio) is a later adapter |
| Acknowledgement | Signed ack link (works from the ntfy action button or a browser) |
| Strength | Escalating backoff + rising notification priority |
| Recurrence | RFC 5545 RRULE + IANA timezone |
| Overlap | Next occurrence supersedes the unacked one (marked MISSED) **and carries over its escalation level** |
| Give-up | Always a safety cap (per-reminder, with a system default), then MISSED |
| Auth | Per-user API keys, issued by admin |
| Extras | Quiet hours, audit/event history |
| Clients | REST API + OpenAPI only |

## Architecture

```
 HTTP client ──► Worker (Hono, /v0, zod-validated, OpenAPI generated)
                   │  auth: API key → D1 lookup (users, api_keys)
                   ▼
           UserNudger Durable Object (one per user, SQLite storage)
             • reminders, occurrences, events, outbox tables
             • ONE alarm = min(next due action) → timer wheel
             • alarm(): process due actions transactionally → outbox → Notifier
                   ▼
           Notifier port ──► NtfyNotifier (now) | TwilioSmsNotifier (later)
 ntfy action button / browser ──► /a/{token} (HMAC-signed ack) ──► UserNudger
```

**Why one Durable Object per user (not per reminder, not a D1 plus cron poller):**
- It's single-threaded and transactional, so there are no races between an ack, the alarm and API edits. That's where the determinism comes from.
- Listing and editing a user's reminders is a strongly consistent local SQLite query, with no fan-out.
- One alarm per user replaces a cron poller, so there's no minute-granularity drift and no idle cost.
- D1 holds only global data: `users` and `api_keys` (hashed).

**Reliability.** Alarms are at-least-once, so every alarm step must be idempotent:
1. In one transaction: advance the occurrence state, append the `event` rows, and insert an `outbox` row keyed `occurrenceId:attempt` (a unique key, so duplicates are no-ops).
2. After commit: deliver pending outbox rows. On failure, back off and retry `tries`, and the retry time feeds into the next alarm computation. Backoff, the retry limit and the schema migrations are in [ADR 0006](adr/0006-user-nudger-storage-migrations-delivery.md).
3. `setAlarm(min(nextNagAt, nextOccurrenceAt, outbox.nextTryAt, quietHoursEnd))`.

## Domain model (pure core, no I/O)
- **User**: `id, name, timezone, quietHours{start,end}?, ntfyTopic` (128-bit random, unguessable)
- **Reminder**: `id, title, body?, dtstart (local datetime + tz), rrule?, strength, cap{maxDuration?, maxAttempts?}, status(ACTIVE|COMPLETED|DELETED)`
- **Occurrence**: `id, reminderId, scheduledFor, level, attempts, state, nextNagAt, closedAt, closeReason`
  - `PENDING → NAGGING → ACKED | MISSED(cap | superseded) | CANCELLED` (`CANCELLED` when its reminder is deleted; see [ADR 0006](adr/0006-user-nudger-storage-migrations-delivery.md))
- **Event** (audit): `id, occurrenceId, type (SCHEDULED|NAG_SENT|SEND_FAILED|DEFERRED_QUIET|ACKED|MISSED|SUPERSEDED|CANCELLED), at, data`

**Strength profiles.** These are pure data, so they're tunable and testable. At level `n`: `interval = max(floor, initial × factor^n)` and `priority = profile.priorityAt(n)`.

| Strength | initial | factor | floor | ntfy priority |
|---|---|---|---|---|
| gentle | 60m | 0.75 | 20m | 3 → 4 |
| firm | 30m | 0.5 | 5m | 3 → 5 |
| relentless | 10m | 0.5 | 2m | 4 → 5 |

**Rules** (each one is a pure function, and each gets property-based tests):
- **Carry-over.** When the next occurrence fires while the previous one is unacked, the previous one becomes `MISSED(superseded)`. After an unacked close (`superseded` or `cap`), the new occurrence starts at `min(prev.level + 1, maxLevel)` if the previous one sent a nag, and at `prev.level` if it sent none (e.g. deferred by quiet hours). Acking resets to level 0 for the next occurrence.
- **Cap.** Stop when `now − scheduledFor ≥ maxDuration` or `attempts ≥ maxAttempts`, whichever comes first. The system default is 24h / 20 attempts (see [ADR 0005](adr/0005-escalation-cap-and-quiet-hours-semantics.md)), and it's enforced even when the reminder leaves the cap unset.
- **Quiet hours.** A nag due inside the user's local window is deferred to the window end (a `DEFERRED_QUIET` event). DST-safe via tz-aware math.
- **Recurrence.** `nextOccurrence(rrule, dtstart, tz, after)` is computed in wall-clock time and then resolved to an instant. Use Temporal (`temporal-polyfill` if the Workers runtime lacks it) plus `rrule-temporal`. DST gaps/overlaps follow RFC 5545 semantics.

**Determinism seams.** Every use case takes `Clock` and `IdGenerator` ports (UUIDv7 in prod, sequential in tests). Nothing in `domain/` reads `Date.now()` or `Math.random()`. A lint rule enforces this.

## API (v0, OpenAPI 3.1 generated from zod via `@hono/zod-openapi`)
- `POST/GET /v0/reminders`, `GET/PATCH/DELETE /v0/reminders/{id}`
- `GET /v0/reminders/{id}/occurrences`, `GET /v0/occurrences/{id}/events`
- `POST /v0/occurrences/{id}/ack` (for API clients)
- `GET /v0/me`, `PATCH /v0/me` (timezone, quiet hours)
- Admin (admin key): `POST /v0/admin/users`, `POST /v0/admin/users/{id}/keys`, `DELETE /v0/admin/users/{id}/keys/{keyId}`
- Public ack: `GET /a/{token}` shows a confirm page (safe against link prefetchers). `POST /a/{token}` performs the ack, and the ntfy `http` action button POSTs directly. Both are idempotent.
- The URI's major version matches the release's major version. Changes within a major version stay backwards compatible, and at most two major versions are served at once ([ADR 0007](adr/0007-versioning-and-compatibility.md)).
- Errors use RFC 9457 `application/problem+json`. Mutating POSTs accept an `Idempotency-Key` header. Key format, error types, validation limits, idempotency and pagination are in [ADR 0008](adr/0008-http-api-conventions.md).

## Security
- **API keys**: `nt5k_<keyId>_<secret>`. Only `SHA-256(secret)` is stored (the secret is high-entropy, so a fast hash is fine), and it's compared in constant time. Keys are revocable per key.
- **Ack tokens**: HMAC-SHA256 over `{occurrenceId, userId, exp, kid}`, with the key in a Workers secret and `kid` allowing rotation. A token only works while the occurrence is open.
- **Tenancy**: each user's data physically lives in their own DO (`idFromName(userId)`), so cross-tenant reads are structurally impossible.
- **Inputs**: all inputs are zod-validated. RRULE limits cap COUNT, forbid sub-minute FREQ and require a minimum interval (e.g. 1m) to prevent alarm storms. Per-key rate limiting uses the Workers Rate Limiting binding.
- **ntfy caveat**: public ntfy.sh topics are readable by anyone who knows the name. Mitigations: unguessable topic names, and titles only (no body) by default. A self-hosted ntfy with access tokens is an upgrade path. I'll document this in an ADR.

## Repo layout
```
src/domain/        recurrence.ts, escalation.ts, quietHours.ts, occurrence.ts (state machine), types.ts
src/app/           use cases + ports (Clock, IdGenerator, Notifier, ReminderRepo)
src/adapters/      ntfy/NtfyNotifier.ts, do/SqliteReminderRepo.ts, d1/AuthStore.ts, crypto/AckToken.ts
src/durable/       UserNudger.ts
src/http/          routes, auth middleware, problem+json, openapi
migrations/        D1 + DO SQLite schema migrations
test/unit/         domain + app (fake clock/notifier), fast-check properties
test/integration/  @cloudflare/vitest-pool-workers: real workerd DO/D1, runDurableObjectAlarm, mocked ntfy fetch
docs/adr/          0001-cloudflare-do-per-user, 0002-ntfy-first, 0003-ack-tokens, ...
wrangler.jsonc, biome.json, tsconfig.json (strict), .github/workflows/
```

## Tooling & delivery ($0)
- TypeScript strict, Biome (lint and format), Vitest.
- `.vscode/extensions.json`:
  - `recommendations`:
    - `biomejs.biome`: lint and format on save. Also set it as the default formatter in `.vscode/settings.json`.
    - `vitest.explorer`: run and debug unit and integration tests from the Test Explorer.
    - `github.vscode-github-actions`: author workflows and view CI runs.
    - `42crunch.vscode-openapi`: navigate and lint the generated OpenAPI spec.
    - `humao.rest-client`: checked-in `.http` files for driving the API, since REST is the only client for now.
    - `qwtel.sqlite-viewer`: inspect local D1 and DO SQLite state under `.wrangler/state`.
    - `editorconfig.editorconfig`: consistent whitespace across editors.
    - `cloudflare.cloudflare-workers-bindings-extension`: Wrangler bindings helper and config IntelliSense. I'll confirm this ID in the Marketplace during scaffolding and drop it if it has changed.
  - `unwantedRecommendations`:
    - `esbenp.prettier-vscode` and `dbaeumer.vscode-eslint`, because Biome replaces both and running them alongside it would cause conflicting formatting.
- **CI** (GitHub Actions): typecheck → lint → unit → integration → coverage gate (≥90% domain, ≥80% overall) → OpenAPI diff check. Add CodeQL if the repo is public, and Dependabot.
- **CD**: `wrangler deploy` to a `staging` env on merge to main and to `production` on tag, using the `CLOUDFLARE_API_TOKEN` repo secret.
- **Observability**: structured JSON logs (Workers Logs) with `userId/reminderId/occurrenceId/requestId`, plus the audit `events` table exposed through the API.
- **Cost**: Workers Free covers 100k requests/day, SQLite-backed DOs and D1, which is far more than family scale needs. Use the `*.workers.dev` domain, so there's no domain cost. The only future spend is SMS.

## Milestones
1. **Scaffold**: wrangler project, CI, ADRs, a Temporal/rrule-in-workerd spike.
2. **Domain core**: recurrence, escalation, cap, quiet hours, state machine, with exhaustive unit and property tests.
3. **UserNudger DO**: SQLite schema, alarm loop, outbox, idempotency. Integration tests with a fake clock.
4. **HTTP API + auth**: API keys, reminders CRUD, OpenAPI.
5. **Ack flow + ntfy adapter**: signed tokens, action buttons, end-to-end test.
6. **Hardening**: rate limits, validation limits, staging deploy, runbook.
7. **Swagger UI**: an interactive API docs page per major version, rendering its OpenAPI document.
8. **Later**: Twilio SMS adapter (inbound replies, 10DLC/toll-free verification), snooze, pause/resume, CLI/web/Shortcuts clients.

## Verification
- `npm test` runs the unit tests: the domain property tests cover DST transitions, leap days, carry-over monotonicity, the cap always terminating, and quiet-hour deferral never landing inside the window.
- `npm run test:integration` runs in workerd. It creates a reminder via the API, advances the fake clock and runs the DO alarm, asserts the ntfy request sequence (intervals and priorities), acks via the token and asserts that nagging stops, then replays the alarm and asserts no duplicate send.
- `wrangler dev` plus a real ntfy topic on a phone gives a manual end-to-end check: create a `relentless` reminder 1 minute out, watch it escalate, tap the ack button and confirm it stops.
- The CI pipeline is green on a PR before merge.
