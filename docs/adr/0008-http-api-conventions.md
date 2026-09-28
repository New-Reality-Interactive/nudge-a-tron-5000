# ADR 0008: HTTP API conventions

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Milestone 4 ([spec](../milestones/04-http-api-auth.md)) puts the `/v0` REST API in front of the `UserNudger` Durable Object. [ADR 0007](0007-versioning-and-compatibility.md) freezes the v0 contract: within v0 the API may only grow. So every convention chosen now (key format, error types, validation limits, idempotency, pagination) is effectively permanent for v0, and anything that rejects input can be loosened later but never tightened. The spec left these open, and they were agreed before implementation.

## Decision

### API keys

- **Format:** `nt5k_<keyId>_<secret>`.
  - `keyId` is 10 random bytes and `secret` is 32 random bytes, both lowercase RFC 4648 base32 with no padding: 16 and 52 characters.
  - The base32 alphabet (`a-z2-7`) has no `_`, so one regular expression parses a key.
- **Storage:** D1 `api_keys` stores the lowercase hex SHA-256 of the secret, never the secret. A fast hash is enough, because the secret has 256 bits of entropy.
- **Verification** (`src/app/auth.ts`):
  - Look the key up by `keyId`, hash the presented secret, and compare the two 32-byte digests in constant time.
  - An unknown `keyId` is compared against a dummy hash, so it takes as long as a wrong secret.
  - Revocation is checked only after the secret matches, so a wrong secret never reveals whether a key exists or is revoked.
  - Missing, malformed, unknown, revoked and wrong keys all get the same `401` with `WWW-Authenticate: Bearer`.
- **Revoking** sets `revoked_at` once. Revoking again succeeds and keeps the first time.
- **The admin key** (`ADMIN_API_KEY`, a Worker secret):
  - Both the presented and the configured value are hashed with SHA-256, then compared in constant time, so the comparison doesn't leak the key's length.
  - An unset or empty admin key never matches.
  - A valid *user* key on an admin route gets `403`. Everything else that fails gets `401`.

### Errors

Every error is an RFC 9457 `application/problem+json` body: `{ type, title, status, detail?, instance, errors? }`. The `type` values are part of the v0 contract. New ones may be added for new situations; these never change.

| status | `type` | when |
|---|---|---|
| 400 | `/problems/validation-failed` | any invalid input: body, query, path or header; malformed JSON; a body that isn't `application/json`; a foreign cursor; an invalid schedule |
| 401 | `/problems/unauthorized` | any authentication failure |
| 403 | `/problems/forbidden` | a user key on an admin route |
| 404 | `/problems/not-found` | an unknown route or resource |
| 409 | `/problems/idempotency-conflict` | an `Idempotency-Key` reused with a different request |
| 500 | `/problems/internal` | anything unexpected |

**Validation errors (`errors`):**
- `errors` lists every invalid input as `{ path, message }`.
- A body field's `path` is its dotted path (`cap.maxAttempts`). Other inputs are prefixed with their location (`query.limit`, `header.idempotency-key`).
- All validation failures are `400`, not a mix of `400` and `422`: one code for clients to handle, and the `errors` array says what's wrong.

**`type` URIs are relative** (RFC 9457 allows this). There's no custom domain, and an absolute `*.workers.dev` URI would differ between environments.

**Another user's id is a `404`, not a `403`.** It lives in a different Durable Object, so for the caller it doesn't exist, and a `404` doesn't confirm that the id is real.

**Unexpected errors:**
- They're logged as one JSON line: request id (`cf-ray`), method, route pattern, error name and message.
- Headers and bodies are never logged, so keys and ntfy topics can't reach the logs.
- The response is a bare `500`, with no stack and no message.

### Validation

**Request bodies are strict:** an unknown field is a `400`, not ignored.
- This catches typos such as `strenght`.
- ADR 0007 allows moving from strict to lenient within v0, but not back.
- Clients must send only the fields they're changing. A `GET` response sent back as a `PATCH` is rejected because of its read-only fields.

**Limits:**

| Input | Limit |
|---|---|
| `title` | 1–200 characters, not blank |
| `body` | at most 2000 characters |
| `cap.maxDurationMinutes` | 1–10080 (7 days) |
| `cap.maxAttempts` | 1–100 |
| user `name` | 1–100 characters, not blank |
| `dtstart` | `YYYY-MM-DDTHH:MM[:SS]`, local to `timezone` |
| `timezone` | an IANA time zone name Temporal knows, exactly as written: not another casing, a date-time or an offset such as `+05:00` |
| `rrule` | at most 500 characters |
| page `limit` | 1–200, default 50 |
| `Idempotency-Key` | 1–255 printable ASCII characters |

**RRULE limits** (`src/app/scheduleLimits.ts`):
- The rule has no `RRULE:` prefix, and only the RFC 5545 §3.3.10 parts appear, each at most once.
- `FREQ` is required and isn't `SECONDLY`.
- `BYSECOND` has at most one value.
- `COUNT` and `INTERVAL` are each 1–1000, and `COUNT` and `UNTIL` aren't both set.

**The 1-minute minimum between occurrences follows from the rule's text:**
- With no `SECONDLY` and a single `BYSECOND`, every occurrence has the same second-of-minute, so no two fall within the same minute.
- A property test checks this against the real recurrence code, across DST changes.
- A larger minimum would need occurrences sampled at request time, and couldn't be exact.
- Occurrences are created lazily (ADR 0006), so `COUNT` doesn't create load. The cap keeps rules reasonable.

**Rules that can never produce an occurrence are rejected at creation:**
- Examples: `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30`, or every 2 minutes starting at :59 with `BYMINUTE=0`.
- `rrule-temporal` gives up on these after 10,000 iterations and throws. The schedule check calls it, so the throw becomes a `400` on `rrule`.
- Realistic sparse rules, such as minutely on the 1st of each month, or Feb 29th, resolve in about a millisecond.

**A `dtstart` in a DST gap is rejected** (ADR 0004):
- The check is in the app layer (`parseSchedule` in `src/app/reminders.ts`), not in the v0 schema. This is an exception to ADR 0006, which put full validation at the HTTP boundary.
- The check needs `dtstart` and `timezone` together, and a `PATCH` that changes only one of them doesn't carry the other.
- A gap is detected by resolving the local time: a nonexistent time moves forward, so its wall-clock time changes. A *repeated* time (clocks going back) keeps its wall-clock time and is allowed. Temporal's `disambiguation: "reject"` would wrongly refuse repeated times too.
- `AppError` gained an optional `field`, so the HTTP layer can put the error on `dtstart`.

### Idempotency

**Scope:**
- `Idempotency-Key` is accepted on the user-authenticated mutating POSTs: `POST /v0/reminders` and `POST /v0/occurrences/{id}/ack`.
- **Admin POSTs don't take it:**
  - Replaying key issuance would mean storing the plaintext key.
  - The admin has no Durable Object to store keys in.
  - The admin acts rarely, by hand. A retried `POST /admin/users` can create a duplicate user, and a retried key issuance creates an extra key to revoke.

**Storage:**
- Per user, in the Durable Object: table `idempotency_keys`, DO migration `0002_idempotency.sql`.
- What's stored is the use case's `AppResult` as JSON, not the HTTP response. The Durable Object stays unaware of API versions (ADR 0007), and a replay goes through the same v0 mapper, so it returns the same status and body.

**Fingerprint:**
- SHA-256 of the method, the path (so the resource) and the validated body as canonical JSON (keys sorted).
- The same body with its keys in another order is the same request.

**Behaviour** (`idempotent` in `src/app/idempotency.ts`), all in one transaction in a single-threaded object, so two requests with the same key can't both run:
- **Same key, same fingerprint:** replay the stored result without running again. This includes stored errors such as `404`.
- **Same key, different fingerprint** (another body, route or resource): `409`, without running.
- **Retention:** 24 hours. Expired rows are deleted at the start of every idempotent call. That's one indexed `DELETE`, and needs no alarm.
- **Validation failures** happen before the Durable Object is called, so they store nothing, and the key stays free.

### Pagination

- Every list returns `{ items, nextCursor }`: reminders (oldest first), a reminder's occurrences (newest first) and an occurrence's events (oldest first).
- `limit` defaults to 50, with a maximum of 200.
- **Keyset pagination:**
  - The cursor is opaque to clients. It's base64url of the last item's id.
  - The next page starts after that item in the list's own order (`(created_at, rowid)`, `(scheduled_for, rowid)` descending, `rowid`), so inserts and deletes between requests never repeat or skip an item.
  - A deleted reminder still works as a cursor.
  - A cursor that doesn't decode is a `400`. An unknown id, including another user's, gives an empty last page.
- The format can change later, because clients only pass the cursor back.

### Users: D1 and the Durable Object

- D1 `users` holds identity: id (UUIDv7, also the Durable Object's name), name, time zone and creation time.
- The Durable Object keeps its own copy of the time zone and quiet hours, because alarms fire without a request.
- `GET /v0/me` returns the name from D1, and the time zone and quiet hours from the Durable Object, which are what scheduling actually uses.
- **Creating a user** seeds the Durable Object's time zone first, then inserts the D1 row. A Durable Object left behind by a failed D1 insert is harmless, because no key can reach it.
- **`PATCH /v0/me`** updates the Durable Object first (it validates the time zone and quiet hours), then D1's time zone. If the second write fails, retrying the same request brings them back in line.

### OpenAPI

- Each major version serves its own OpenAPI 3.1 document at `/vN/openapi.json`, built from the zod schemas by `@hono/zod-openapi`.
- **The snapshot:**
  - The document is committed as `openapi/vN.json`. `npm run openapi` regenerates it.
  - A unit test compares the generated document with the snapshot, and CI runs it as the `OpenAPI diff check` step (`npm run openapi:check`, which never writes the snapshot).
  - The unit project also validates the document against the OpenAPI 3.1 schema, and checks that every served route is documented.
- **Breaking changes:**
  - On pull requests, CI runs `oasdiff` (`oasdiff/oasdiff-action/breaking`) on the base branch's snapshot against the PR's, and fails on any `ERR`-level change.
  - `.oasdiff.yaml` lowers three checks to `info`: `response-property-enum-value-added`, `response-property-one-of-added` and `response-body-one-of-added`. They cover new response enum values and new variants such as new event types, which ADR 0007 allows because clients must ignore values they don't know.
  - `review: false` and an empty `github-token` keep the specs inside CI: nothing is uploaded to oasdiff.com and no PR comment is posted.

## Consequences

- **The limits above are the floor for all of v0.** Raising one is a compatible change, recorded here.
- **Admin retries aren't idempotent.** The admin resolves duplicates by hand.
- **`idempotency_keys` grows with use** and is trimmed on every idempotent call. A user who stops posting keeps at most a day of rows until their next call.
- **The DST-gap check lives in the app layer,** so it applies to every API version, which is correct under any contract.
- **An `oasdiff` false positive** is handled by lowering its check in `.github/oasdiff-levels.txt`, with a note here explaining why ADR 0007 allows it. Deliberate breaking changes ship as a new major version with its own snapshot, so the `/v0` check never needs overriding.
