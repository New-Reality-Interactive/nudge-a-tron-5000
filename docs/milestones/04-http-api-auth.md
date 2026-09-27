# Milestone 4: HTTP API + auth

**Status:** Not started
**Depends on:** Milestone 3
**Branch:** `feat/http-api-auth`

## Goal

Put the versioned REST API in front of the `UserNudger` DO: per-user API keys stored in D1, strict input validation, consistent error responses, and an OpenAPI 3.1 spec generated from the zod schemas. This milestone also adds the **first real D1 migration**, which is the first time the migration step in the deploy workflow changes a database.

## Scope

1. **D1 schema** (`migrations/d1/0001_…sql`):
   - `users`: id, name, timezone, created_at
   - `api_keys`: key_id, user_id, secret_hash, created_at, revoked_at

   Migrations only ever add. Never edit a migration once it's merged.
2. **Auth store** (`src/adapters/d1/AuthStore.ts`) and **auth middleware** (`src/http/`):
   - Key format: `nt5k_<keyId>_<secret>`.
   - Look up the key by `keyId`, compute `SHA-256(secret)`, and compare it with the stored hash in constant time.
   - Revoked or unknown keys get a 401 problem response.
   - The middleware puts `userId` on the request context.
3. **Admin auth:** admin routes require `ADMIN_API_KEY`, the Worker secret, compared in constant time.
4. **Routes** (`/v0`, Hono with `@hono/zod-openapi`). The user's DO is always found with `idFromName(userId)`:
   - `POST /v0/reminders`, `GET /v0/reminders`, `GET/PATCH/DELETE /v0/reminders/{id}`
   - `GET /v0/reminders/{id}/occurrences`, `GET /v0/occurrences/{id}/events`
   - `POST /v0/occurrences/{id}/ack`: API-client ack
   - `GET /v0/me`, `PATCH /v0/me`: timezone and quiet hours
   - Admin: `POST /v0/admin/users`, `POST /v0/admin/users/{id}/keys` (returns the full key **once**), `DELETE /v0/admin/users/{id}/keys/{keyId}`
5. **Validation (zod)** on every input. **RRULE limits** prevent alarm storms:
   - cap `COUNT`
   - no `FREQ` finer than a minute
   - a minimum interval between occurrences (e.g. 1 minute)
   - a valid IANA timezone
   - a `dtstart` local time that exists in its timezone (not inside a DST gap; see ADR 0004)
   - limits on title and body length
6. **Errors:** everything returns RFC 9457 `application/problem+json`. That covers validation errors (with field details), 401, 403, 404, 409 and 500. Responses never include stack traces or secrets.
7. **`Idempotency-Key`** on mutating POSTs: the same key with the same body replays the stored response, and the same key with a different body gets a 409. Keys are stored per user in the DO, with an expiry (propose one).
8. **OpenAPI:**
   - Serve the spec at `GET /v0/openapi.json`. Each supported major version has its own document ([ADR 0007](../adr/0007-versioning-and-compatibility.md)).
   - Commit a generated snapshot at `openapi/v0.json`.
   - Add a CI step that fails when the committed snapshot differs from the generated one: an **OpenAPI diff check**, added to `ci.yml` in the `verify` job.
9. **REST Client files:** add `requests/*.http` covering the main flows.

## Out of scope

- Signed ack tokens, `/a/{token}`, and the ntfy adapter (M5)
- Rate limiting (M6)

## Tests

- **Integration (workerd, real D1):**
  - Apply the D1 migrations in the test setup (`applyD1Migrations` / `readD1Migrations`).
  - Auth: missing, malformed, unknown, revoked and valid keys. The admin key is required on admin routes.
  - The CRUD flow end to end through the DO.
  - Tenancy: user A can never see or change user B's reminders.
  - Validation and RRULE limits: each rejected case returns problem+json with details.
  - Idempotency: replay, and a conflict on a different body.
  - The OpenAPI document is valid, and every route appears in it.
- **Unit:** key parsing and hashing, the RRULE-limit validator, and mapping errors to problem responses.

## Acceptance criteria

- [ ] The first D1 migration is added and applies cleanly in tests
- [ ] All routes are implemented and documented in OpenAPI
- [ ] The OpenAPI snapshot is committed, and the CI diff check is part of `verify`
- [ ] Auth, tenancy, validation and idempotency tests pass. `npm run coverage` passes
- [ ] Secrets never appear in logs or responses. Constant-time comparison is used for API keys and the admin key
- [ ] `requests/*.http` covers the main flows
- [ ] README updated with API usage and how to create the first user and key
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- Where do `users` live? D1 is the source of truth. Does the DO keep a copy of timezone and quiet hours, or does it get them on each call?
- How are lists paginated: by cursor or offset? What's the default page size?
- How long are idempotency keys kept, and are they stored in the DO or in D1?
- `DELETE /v0/reminders/{id}`: soft delete (status `DELETED`) as the domain model says. Confirm what happens to any open occurrence.
- Should CI also fail on a **breaking** change to the OpenAPI document, for example with `oasdiff`, to enforce [ADR 0007](../adr/0007-versioning-and-compatibility.md)? That would be a new dev dependency.

## Post-merge

- **First real D1 migration.** In the Deploy run, the "Apply D1 migrations" step should list `0001_…` and apply it to **staging**. Afterwards, check it:
  `npx wrangler d1 migrations list DB --remote --env staging`
- **Smoke test on staging:**
  1. Create a user and key through the admin route, using the staging `ADMIN_API_KEY`.
  2. Create a reminder, list it, then delete it.
- **Production:** the migration only runs there when you tag a release. Check the same way with `--env production`.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 4: HTTP API + auth

Implement `docs/milestones/04-http-api-auth.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
Load `cloudflare:workers-best-practices` and `cloudflare:wrangler` before planning.

## How to start
1. Read `CLAUDE.md`, the milestone spec, `docs/architecture.md` (API and Security sections),
   the ADRs, and the `UserNudger` RPC surface and use cases from M3.
2. Propose a short implementation plan: the D1 schema, the route list with zod schemas, the
   auth flow, the error model, idempotency storage, the OpenAPI snapshot and CI diff design,
   new dependencies (latest versions, and whether they need install scripts), and your answers
   to the spec's open questions. Wait for my approval before writing code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- The D1 migration only ever adds: never rewrite a merged migration. Call it out in the PR.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- Don't run `/code-review` until I say yes to it (see below), and don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do (including verifying
the D1 migration on staging), and any manual steps.

Then, as the last thing in that message and on its own line, ask me whether to run
`/code-review` now. If I say yes, run it, fix what it finds with my approval, and report again.
```
