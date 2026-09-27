# Nudge-A-Tron 5000

Nagging-reminder REST API. TypeScript on Cloudflare Workers (Hono), one SQLite-backed Durable
Object (`UserNudger`) per user, D1 for global data (users, api_keys), ntfy.sh notifications
behind a `Notifier` port. Target: $0 hosting.

**Source of truth:** `docs/architecture.md` (plan and milestones) and `docs/adr/`. Read them
before designing anything. If the plan looks wrong or ambiguous, ask. Don't improvise.
Significant new decisions get a new ADR. Per-milestone scope, tests and acceptance criteria
are in `docs/milestones/`. Update a milestone's Status and checklist in the PR that delivers it.

## Commands
- `npm run typecheck`: checks `wrangler types` output is current, then `tsc --noEmit` (TS 7)
- `npm run lint` / `npm run format`: Biome check / Biome with `--write`
- `npm test`: both Vitest projects. `npm run test:unit`, `npm run test:integration` run one each
- `npm run coverage`: v8 coverage gate (unit project only)
- `npm run cf-typegen`: run after any `wrangler.jsonc` change
- `npm run dev`: local Worker on :8787, inspector on :9229

## Architecture rules
- `src/domain` is pure: no I/O, no Workers APIs, no ambient time or randomness. Inject
  `Clock` / `IdGenerator` ports (defined in `src/app`). The GritQL plugin
  `biome-plugins/domain-determinism.grit` enforces this. It is enabled by the nested
  `src/domain/biome.json` because Biome 2.5 ignores plugin `includes`/`overrides` scoping.
  Keep that file.
- Layers: `domain` ← `app` (use cases, ports) ← `adapters` / `durable` / `http`. Dependencies
  point inward only.
- DO alarms are at-least-once. Every alarm step is idempotent: one transaction → outbox row keyed
  `occurrenceId:attempt` → deliver after commit.
- Temporal: workerd has no native `Temporal`. Import from `temporal-polyfill` and pass it to
  `rrule-temporal` via its `temporal` option.
- Security: hash API keys (SHA-256) and compare in constant time; validate all input with zod;
  never log secrets or ntfy topics; ntfy messages carry titles only by default (ADR 0002).

## Testing
- `test/unit/`: Node. Domain and app logic, including fast-check property tests for domain
  rules. **Only this project counts toward coverage** (≥90% `src/domain`, ≥80% overall),
  because workerd lacks `node:inspector`. Put logic where it can be measured.
- `test/integration/`: workerd via `@cloudflare/vitest-pool-workers`. Real DO/D1,
  `runDurableObjectAlarm`, mocked outbound `fetch`.
- Check exit codes directly. Never pipe `lint`/`typecheck`/`test` through `tail` or `grep`
  when deciding pass/fail, because the pipe hides failures.

## Pinned on purpose. Ask before changing
- `compatibility_date` `2026-08-22`: capped by the workerd bundled in the test pool.
- Vitest 4.x (pool peer range `^4.1.0`) and `@types/node` 24.x (Node 24 LTS). Dependabot
  holds both majors in `.github/dependabot.yml`.
- `allowScripts` in `package.json` only allows install scripts for esbuild and workerd. Ask
  before approving another package.

## Migrations and deploys
- D1: `migrations/d1/*.sql`, applied by `deploy.yml` (`wrangler d1 migrations apply --remote`)
  before `wrangler deploy`. Migrations must be forward-only and safe to run on a live database.
- DO SQLite: `migrations/do/`, applied inside `UserNudger` (mechanism defined in Milestone 3).
- Merging to `main` runs CI, then deploys to staging, unless every changed file is in
  `paths-ignore` in `deploy.yml` (docs, tests, editor/lint config). A `v*` tag on a commit
  already on `main` runs CI, then deploys to production. Anything that can change the bundle
  or the database (including `tsconfig.json`) must stay off that ignore list.

## Git workflow
- Never commit to `main`. Branch from an up-to-date `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional Commits, grouped logically. Typecheck, lint and test must pass before each commit.
- **Don't push until the user says so.** Then push with `-u`, open a PR with `gh pr create`
  following `.github/pull_request_template.md`, watch the `verify` check, and report the PR URL.
- **Never merge PRs** and never push tags unless asked. The `main` ruleset requires `verify`
  and an up-to-date branch, with no bypass.

## Useful paths
- `requests/*.http`: REST Client requests against `npm run dev`
- `.dev.vars` (gitignored; copy from `.dev.vars.example`): local secrets
