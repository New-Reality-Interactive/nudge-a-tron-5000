# Nudge-A-Tron 5000

A REST API for **nagging reminders**. A reminder fires on a schedule, which can recur (RFC 5545 RRULE with an IANA time zone). It then keeps notifying you, more insistently each time, until you acknowledge it.

- **Runtime:** TypeScript on Cloudflare Workers ([Hono](https://hono.dev)), with one SQLite-backed Durable Object per user
- **Notifications:** [ntfy.sh](https://ntfy.sh) push, behind a pluggable `Notifier` port
- **Cost:** designed to run at $0 on the Workers Free plan

> **Status:** Milestone 1 (scaffold). Only `GET /healthz` exists so far. See the [architecture plan](docs/architecture.md) for the roadmap.

## Documentation

- [Architecture and plan](docs/architecture.md)
- Architecture Decision Records:
  - [0001: Cloudflare Workers with one Durable Object per user](docs/adr/0001-cloudflare-workers-do-per-user.md)
  - [0002: ntfy first, behind a `Notifier` port](docs/adr/0002-ntfy-first-behind-notifier-port.md)
  - [0003: HMAC-signed ack tokens](docs/adr/0003-hmac-signed-ack-tokens.md)
  - [0004: Temporal and RRULE for recurrence](docs/adr/0004-temporal-and-rrule-for-recurrence.md)

## Prerequisites

- **Node.js 24 LTS**. The version is pinned in `.nvmrc`, so run `nvm use`.
- **npm 11+**. It ships with Node 24.
- **VS Code** is recommended. Accept the workspace's recommended extensions when prompted.
- A **Cloudflare account** is only needed to deploy. Local dev and tests run entirely in local workerd.

## Setup

```sh
nvm use
npm ci
cp .dev.vars.example .dev.vars   # then fill in real values (openssl rand -base64 32)
npm run dev                      # http://localhost:8787/healthz
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

## Project layout

```
src/domain/        pure core: recurrence, escalation, quiet hours, state machine (no I/O, no clock)
src/app/           use cases + ports (Clock, IdGenerator, Notifier, ReminderRepo)
src/adapters/      ntfy, Durable Object SQLite repo, D1 auth store, crypto
src/durable/       UserNudger Durable Object
src/http/          routes, auth middleware, problem+json, OpenAPI
migrations/        D1 (migrations/d1) and DO SQLite (migrations/do) schemas
test/unit/         Node tests for domain and app
test/integration/  workerd tests (real DO, D1, alarms)
docs/              architecture plan and ADRs
requests/          REST Client (.http) files
```

### Determinism rule

Code in `src/domain/**` must not read ambient time or randomness. `Date.now`, argless `new Date()`, `Math.random`, `performance.now` and `crypto.randomUUID`/`getRandomValues` are lint errors there. Inject the `Clock` and `IdGenerator` ports instead. The rule lives in `biome-plugins/domain-determinism.grit` and is enabled by `src/domain/biome.json`.

## Testing notes

- **Coverage** counts only what the `unit` project exercises. workerd has no `node:inspector`, so v8 can't instrument integration runs. Keep logic in `src/domain` and `src/app`, where it can be measured.
- **Debugging** uses the launch configs in `.vscode/launch.json`:
  - *Attach to wrangler dev* (port 9229).
  - *Debug current test file (unit, Node)*.
  - *Debug current test file (integration, workerd)*. This starts Vitest in watch mode with the inspector on port 9230. Once it's attached, press `r` in the task terminal to re-run with breakpoints active.
- **`compatibility_date`** is capped at the newest date the test pool's bundled workerd supports. Bump it when `@cloudflare/vitest-pool-workers` updates.

## Deployment

`.github/workflows/deploy.yml` deploys to **staging** on every push to `main` and to **production** on `v*` tags. It stays inert until the `CLOUDFLARE_API_TOKEN` repository secret exists. One-time setup:

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

`main` is protected. All changes go through a pull request, and force pushes and branch deletion are blocked for everyone. CI (`verify`) runs typecheck, lint, unit tests, integration tests and the coverage gate.
