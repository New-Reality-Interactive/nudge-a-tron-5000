# Nudge-A-Tron 5000

A REST API for **nagging reminders**. A reminder fires on a schedule, which can recur (RFC 5545 RRULE with an IANA time zone). It then keeps notifying you, more insistently each time, until you acknowledge it.

- **Runtime:** TypeScript on Cloudflare Workers ([Hono](https://hono.dev)), with one SQLite-backed Durable Object per user
- **Notifications:** [ntfy.sh](https://ntfy.sh) push, behind a pluggable `Notifier` port
- **Cost:** designed to run at $0 on the Workers Free plan

> **Status:** Milestone 4. The `/v0` REST API is live behind per-user API keys. Notifications (ntfy) and ack links arrive in Milestone 5. See the [architecture plan](docs/architecture.md) for the roadmap.

## Documentation

- [Architecture and plan](docs/architecture.md)
- [Milestones](docs/milestones/README.md): one spec per milestone, each with a kickoff prompt
- Architecture Decision Records:
  - [0001: Cloudflare Workers with one Durable Object per user](docs/adr/0001-cloudflare-workers-do-per-user.md)
  - [0002: ntfy first, behind a `Notifier` port](docs/adr/0002-ntfy-first-behind-notifier-port.md)
  - [0003: HMAC-signed ack tokens](docs/adr/0003-hmac-signed-ack-tokens.md)
  - [0004: Temporal and RRULE for recurrence](docs/adr/0004-temporal-and-rrule-for-recurrence.md)
  - [0005: Escalation, cap and quiet-hours semantics](docs/adr/0005-escalation-cap-and-quiet-hours-semantics.md)
  - [0006: UserNudger storage, migrations and delivery](docs/adr/0006-user-nudger-storage-migrations-delivery.md)
  - [0007: Versioning and compatibility](docs/adr/0007-versioning-and-compatibility.md)
  - [0008: HTTP API conventions](docs/adr/0008-http-api-conventions.md)

## Prerequisites

- **Node.js 24 LTS**. The version is pinned in `.nvmrc`, so run `nvm use`.
- **npm 11+**. It ships with Node 24.
- **VS Code** is recommended. Accept the workspace's recommended extensions when prompted.
- A **Cloudflare account** is only needed to deploy. Local dev and tests run entirely in local workerd.

## Setup

```sh
nvm use
npm ci
cp .dev.vars.example .dev.vars                 # then fill in real values (openssl rand -base64 32)
npx wrangler d1 migrations apply DB --local    # create the local D1 tables (once per new migration)
npm run dev                                    # http://localhost:8787/healthz
```

`package.json` has an `allowScripts` list. npm will only run install scripts for `esbuild` and `workerd`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Runs the Worker locally with `wrangler dev` (workerd inspector on port 9229) |
| `npm run deploy` | `wrangler deploy`. Add `-- --env staging` or `-- --env production` to pick an environment |
| `npm run cf-typegen` | Regenerates `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `npm run typecheck` | Checks the generated types are current, then runs `tsc --noEmit` (strict) |
| `npm run lint` | Runs Biome lint and format checks |
| `npm run format` | Runs Biome with `--write`, which formats, applies safe fixes and organizes imports |
| `npm test` | Runs both Vitest projects: `unit` (Node) and `integration` (workerd) |
| `npm run test:unit` | Runs unit tests only |
| `npm run test:integration` | Runs integration tests in workerd via `@cloudflare/vitest-pool-workers` |
| `npm run coverage` | v8 coverage gate on the unit project: ≥90% for `src/domain`, ≥80% overall |
| `npm run openapi` | Regenerates the committed OpenAPI snapshot, `openapi/v0.json`. Run it after changing the API, and review the diff |
| `npm run openapi:check` | Fails if `openapi/v0.json` doesn't match the code (CI runs this) |

## Project layout

```
src/domain/        pure core: recurrence, escalation, quiet hours, state machine (no I/O, no clock)
src/app/           use cases + ports (Clock, IdGenerator, Notifier, ReminderRepo)
src/adapters/      ntfy, Durable Object SQLite repo, D1 auth store, crypto
src/durable/       UserNudger Durable Object
src/http/          root app, shared middleware (auth, errors, idempotency), and one directory per
                   API major version (v0/: routes, zod schemas, mappers, OpenAPI)
migrations/        D1 (migrations/d1) and DO SQLite (migrations/do) schemas
openapi/           committed OpenAPI snapshot per API major version (v0.json)
test/unit/         Node tests for domain and app
test/integration/  workerd tests (real DO, D1, alarms)
docs/              architecture plan and ADRs
requests/          REST Client (.http) files
```

### Determinism rule

Code in `src/domain/**` must not read ambient time or randomness. `Date.now`, argless `new Date()`, bare `Date()`, `Temporal.Now`, `Math.random`, `performance.now` and `crypto.randomUUID`/`getRandomValues` (with or without a `globalThis.` prefix) are lint errors there. Inject the `Clock` and `IdGenerator` ports instead. The rule lives in `biome-plugins/domain-determinism.grit` and is enabled by `src/domain/biome.json`.

## Testing notes

- **Coverage** counts only what the `unit` project exercises. workerd has no `node:inspector`, so v8 can't instrument integration runs. Keep logic in `src/domain` and `src/app`, where it can be measured.
- **Debugging** uses the launch configs in `.vscode/launch.json`:
  - *Attach to wrangler dev* (port 9229).
  - *Debug current test file (unit, Node)*.
  - *Debug current test file (integration, workerd)*. This starts Vitest in watch mode with the inspector on port 9230. Once it's attached, press `r` in the task terminal to re-run with breakpoints active.
- **`compatibility_date`** is capped at the newest date the test pool's bundled workerd supports. Bump it when `@cloudflare/vitest-pool-workers` updates.

## Using the API

The API is served at `/v0`, and its OpenAPI 3.1 document at [`/v0/openapi.json`](openapi/v0.json). The [`requests/`](requests/) folder has ready-to-run REST Client files for every flow.

- **Auth:** send your API key as a Bearer token: `Authorization: Bearer nt5k_<keyId>_<secret>`. Admin routes (`/v0/admin/…`) take the `ADMIN_API_KEY` secret instead.
- **Errors** are `application/problem+json` (RFC 9457). A `400` lists each invalid input in `errors`.
- **Retries:** `POST /v0/reminders` and `POST /v0/occurrences/{id}/ack` accept an `Idempotency-Key` header. Retrying with the same key and body within 24 hours returns the first response instead of repeating the request.
- **Lists** return `{ items, nextCursor }`. Pass `nextCursor` back as `?cursor=` for the next page (`?limit=` up to 200, default 50).
- **Compatibility:** within `/v0` the API only grows ([ADR 0007](docs/adr/0007-versioning-and-compatibility.md)). Ignore response fields and enum values you don't recognise.

| Route | What it does |
|---|---|
| `POST /v0/reminders`, `GET /v0/reminders` | Create a reminder; list yours |
| `GET` / `PATCH` / `DELETE /v0/reminders/{id}` | Read, change or delete one. Deleting cancels its open occurrence |
| `GET /v0/reminders/{id}/occurrences` | Its occurrences, newest first |
| `GET /v0/occurrences/{id}/events` | An occurrence's audit trail |
| `POST /v0/occurrences/{id}/ack` | Acknowledge an occurrence, which stops its nags |
| `GET` / `PATCH /v0/me` | Your time zone and quiet hours |
| `POST /v0/admin/users` | Create a user (admin) |
| `POST /v0/admin/users/{userId}/keys` | Issue an API key; the full key is shown once (admin) |
| `DELETE /v0/admin/users/{userId}/keys/{keyId}` | Revoke a key (admin) |

A reminder looks like this. `dtstart` is local wall-clock time in `timezone`, and `rrule` is an [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10) rule without the `RRULE:` prefix. [ADR 0008](docs/adr/0008-http-api-conventions.md) has the limits.

```json
{
  "title": "Take the bins out",
  "dtstart": "2030-06-10T19:00",
  "timezone": "America/New_York",
  "rrule": "FREQ=WEEKLY;BYDAY=MO",
  "strength": "firm",
  "cap": { "maxAttempts": 10 }
}
```

### Creating the first user and key

Users and keys are created with the admin key. Locally, that's `ADMIN_API_KEY` in `.dev.vars`; on staging and production, it's the Worker secret you set with `wrangler secret put`. The Worker must be running (`npm run dev`), or use the deployed `*.workers.dev` URL.

```sh
BASE=http://localhost:8787/v0
read -rs ADMIN && export ADMIN    # paste the admin key; it isn't echoed or saved in history

# 1. Create the user. Note the "id" in the response.
curl -s -X POST "$BASE/admin/users" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"name": "Ada", "timezone": "America/New_York"}'

# 2. Issue their API key. The response's "key" is shown only once: give it to the user.
curl -s -X POST "$BASE/admin/users/<user id>/keys" -H "Authorization: Bearer $ADMIN"

# 3. The user can now call the API with it.
curl -s "$BASE/me" -H "Authorization: Bearer nt5k_..."
```

To revoke a key: `DELETE /v0/admin/users/<user id>/keys/<keyId>`. Only a hash of each key is stored, so a lost key can't be recovered. Issue a new one and revoke the old one.

## Deployment

`.github/workflows/deploy.yml` deploys to **staging** on every push to `main` and to **production** on `v*` tags. Every deploy first runs the full CI suite, and a production tag must point at a commit that is already on `main`. Pushes to `main` that only change docs, tests or editor/lint config skip the staging deploy (see `paths-ignore` in the workflow). To redeploy by hand, run the **Deploy** workflow from the Actions tab: on `main` for staging, or on a `v*` tag for production. Before each deploy, the workflow applies any new D1 migrations to that environment's database (`wrangler d1 migrations apply --remote`). The workflow stays inert until the `CLOUDFLARE_API_TOKEN` repository secret exists. One-time setup:

1. Create D1 databases and paste their IDs into `wrangler.jsonc`:
   ```sh
   npx wrangler d1 create nudge-a-tron-5000-staging
   npx wrangler d1 create nudge-a-tron-5000-production
   ```
2. Set the Worker secrets for each environment:
   ```sh
   npx wrangler secret put ACK_SIGNING_KEY --env staging
   npx wrangler secret put ADMIN_API_KEY  --env staging
   # repeat with --env production
   ```
3. Add these GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`: create it from the *Edit Cloudflare Workers* template, and include D1 edit permission.
   - `CLOUDFLARE_ACCOUNT_ID`.

## Contributing

`main` is protected. All changes go through a pull request, and force pushes and branch deletion are blocked for everyone. CI (`verify`) runs typecheck, lint, unit tests, integration tests, the coverage gate, and the OpenAPI checks: the committed `openapi/v0.json` must match the code, and on pull requests `oasdiff` fails any breaking change to it ([ADR 0008](docs/adr/0008-http-api-conventions.md)).
