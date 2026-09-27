# Milestone 1: Scaffold

**Status:** ✅ Done. Merged in PRs #1, #5, #6 and #7, and released as `v0.1.0` on 2026-09-27.

This page records what was built and where to find it. There is nothing left to implement.

## Delivered

- **Project and tooling**
  - Worker project: Hono app with `GET /healthz`, a stub `UserNudger` Durable Object (SQLite, migration `v1`), and the D1 binding `DB`.
  - `staging` and `production` environments with real D1 database IDs.
  - TypeScript 7 in strict mode.
  - Biome, including the determinism lint rule for `src/domain`.
  - Vitest with `unit` (Node) and `integration` (workerd) projects, and a v8 coverage gate.
- **CI/CD**
  - CI: the `verify` job, required on `main`.
  - Deploy workflow: staging on merges to `main`, skipping pushes that only change docs, tests or config. Production on `v*` tags pointing at commits on `main`. Manual runs via `workflow_dispatch`.
  - Dependabot, which holds back the Vitest and `@types/node` majors.
- **Repo protection and security**
  - The `protect-main` ruleset requires a PR, the `verify` check and an up-to-date branch. It blocks force pushes and branch deletion, and nobody can bypass it.
  - CodeQL, secret scanning with push protection, and Dependabot security updates are enabled.
- **Docs**
  - `README.md`, `CLAUDE.md`, `docs/architecture.md`, and ADRs 0001–0004.
  - Recurrence spike: `rrule-temporal` with `temporal-polyfill` computes correct occurrences across DST changes inside workerd (see [ADR 0004](../adr/0004-temporal-and-rrule-for-recurrence.md)).

## Deployed

- Staging: `https://nudge-a-tron-5000-staging.new-reality-interactive.workers.dev`
- Production: `https://nudge-a-tron-5000-production.new-reality-interactive.workers.dev`

## Carried forward

- Delete the recurrence spike in Milestone 2.
- Raise `compatibility_date` and lift the Vitest 5 hold when `@cloudflare/vitest-pool-workers` supports newer versions.
- Token expiry: the Cloudflare API token expires on 2027-09-27. The `nudge-a-tron-5000-token` GitHub token expires on the date you chose when you created it. Renew both before they expire.
