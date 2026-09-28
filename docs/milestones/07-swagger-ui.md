# Milestone 7: Swagger UI

**Status:** Not started
**Depends on:** Milestone 6 (it only needs M4's OpenAPI document, so it could be pulled forward if you choose)
**Branch:** `feat/swagger-ui`

## Goal

Give people a browsable, interactive view of the API. A Swagger UI page served by the Worker renders the same OpenAPI 3.1 document that `/v0/openapi.json` already returns, and lets someone with an API key try requests from the browser. Nothing about the API contract changes: this adds one read-only page per API major version.

## Scope

1. **A Swagger UI route per major version**, for example `GET /v0/docs` (the path is an open question):
   - It renders `/v0/openapi.json`, the document the Worker already serves. It adds no second copy of the spec.
   - It needs no API key, like `/v0/openapi.json`, since the document is already public.
   - Each supported major gets its own page, the same way each gets its own document ([ADR 0007](../adr/0007-versioning-and-compatibility.md)). A future `/v1` adds `/v1/docs` beside it.
   - The route lives in `src/http/v0/` next to `openapi.ts`, and is **hidden from the OpenAPI document**, so `openapi/v0.json` doesn't change and oasdiff sees no difference.
2. **"Try it out" works with API keys:**
   - The page's Authorize dialog uses the document's existing `apiKey` and `adminKey` bearer schemes.
   - Requests go to the same origin (the document's `servers` is `/v0`), so no CORS is needed.
   - **Keys aren't persisted.** `persistAuthorization` stays off, so a key typed into the page lives only in that tab's memory and never in `localStorage`.
3. **Where Swagger UI's assets come from** is decided in the plan (see the open questions):
   - **From a CDN:** the page pulls `swagger-ui-dist` from jsdelivr, as `@hono/swagger-ui` does by default. There's almost nothing to bundle, but the page depends on a third-party CDN, and the version must be pinned, ideally with Subresource Integrity.
   - **Self-hosted:** the Worker serves `swagger-ui-dist` from Workers static assets. There's no third party, and the Content Security Policy can be `'self'`-only, but it needs an `assets` binding in `wrangler.jsonc` (and `npm run cf-typegen`) and adds to the upload.
4. **Security headers on the page:**
   - A Content-Security-Policy that allows only what the page needs: the asset origin, and `connect-src 'self'` for API calls.
   - `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
   - The headers apply to the docs page only, not to the JSON API responses.
5. **Docs:** the README links the page, and `requests/me.http` or the README shows where to find it.

## Out of scope

- Changing the OpenAPI document or any API route. If the document needs better descriptions or examples to read well in Swagger UI, list them as follow-ups. Changing it here would change the snapshot and the v0 contract.
- Other renderers (Redoc, Scalar, etc.) and hosting the docs anywhere other than the Worker.
- CORS for calling the API from other origins (a candidate in [08-later.md](08-later.md) under "Clients").

## Tests

- **Integration (workerd):**
  - `GET /v0/docs` returns `200` `text/html` with no key, and the page points Swagger UI at `/v0/openapi.json`.
  - The response carries the CSP and the other security headers, and the CSP doesn't allow `unsafe-eval`.
  - The page doesn't enable `persistAuthorization`.
  - The route is absent from `/v0/openapi.json`, and `npm run openapi:check` still passes with the snapshot unchanged.
  - If self-hosted: the asset URLs the page references return `200` with the right content types.
- **Unit:** anything the page builder decides (the CSP string, the asset URLs, the pinned version) is tested where it can count toward coverage.

## Acceptance criteria

- [ ] `GET /v0/docs` (or the path agreed in the plan) serves Swagger UI rendering the v0 document, with no key needed
- [ ] "Try it out" works against the same Worker with a user key and with the admin key, and keys aren't persisted
- [ ] The page has a Content-Security-Policy and the other security headers, and the asset source is pinned
- [ ] `openapi/v0.json` is unchanged, and oasdiff reports no difference
- [ ] README updated with where to find the page
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- **Path:** `/v0/docs`, one page per major beside its document, or a single `/docs` that links to each served major?
- **Assets:** load Swagger UI from jsdelivr (via `@hono/swagger-ui`, pinned with Subresource Integrity), or self-host `swagger-ui-dist` with Workers static assets? Consider the third-party dependency, the CSP, the bundle and upload size (the Free plan's limit is 3 MB compressed), and how Dependabot keeps the version current.
- **Production:** serve the page in production as well as staging? The document is already public, so it reveals nothing new, but it does make "Try it out" against production one click away.
- Does this need an ADR? It probably does if assets come from a CDN, since that adds the first third-party runtime dependency for a page the Worker serves.

## Post-merge

- **Staging:**
  1. Open the staging `/v0/docs` in a browser. Every route should be listed and render without console errors (in particular, no CSP violations).
  2. Authorize with a staging user key and run `GET /me`. It should return `200`.
  3. Reload the page. The key should be gone.
- **Production:** once you've given the go-ahead and the tag has deployed, open the production page and check that it loads.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 7: Swagger UI

Implement `docs/milestones/07-swagger-ui.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
Load `cloudflare:workers-best-practices` and `cloudflare:wrangler` before planning.

## How to start
1. Read `CLAUDE.md`, the milestone spec, ADRs 0007 and 0008, and the HTTP layer from M4
   (`src/http/app.ts`, `src/http/v0/openapi.ts`).
2. Propose a short implementation plan: the route and where it lives, how the page is built,
   where the assets come from and how their version is pinned, the security headers, the tests,
   new dependencies (latest versions, and whether they need install scripts), and your answers
   to the spec's open questions. Wait for my approval before writing code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- Don't change the OpenAPI document: `openapi/v0.json` must stay the same.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- Don't run `/code-review` until I say yes to it (see below), and don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do, and any manual steps.

Then, as the last thing in that message and on its own line, ask me whether to run
`/code-review` now. If I say yes, run it, fix what it finds with my approval, and report again.
```
