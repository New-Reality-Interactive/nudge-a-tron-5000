# Milestone 6: Hardening

**Status:** Not started
**Depends on:** Milestone 5
**Branch:** `feat/hardening`

## Goal

Make the MVP safe to leave running for family and friends: abuse limits, logs you can actually search, a staging soak with real notifications, and a runbook for the operational tasks that come up rarely but matter when they do.

## Scope

1. **Rate limiting:**
   - Per API key on `/v1/*`, using the Workers **Rate Limiting** binding. The binding is added to `wrangler.jsonc` for all environments.
   - Per IP on the public `/a/{token}` routes.
   - Over-limit requests get `429` as problem+json, with `Retry-After`.
2. **Validation limits review:** go over every input limit from M4 and M5 and check it against abuse cases:
   - maximum reminders per user
   - maximum active occurrences
   - RRULE `COUNT` and interval
   - payload size
   - title and body length

   Tighten or add limits where they're missing, and document all of them in one place, for example in the README or the OpenAPI descriptions.
3. **Structured logging:**
   - JSON logs through Workers Logs (observability is already on in `wrangler.jsonc`).
   - Each entry carries `requestId`, `userId`, `reminderId` and `occurrenceId` where they apply.
   - A request-ID middleware returns an `X-Request-Id` header.
   - A redaction helper makes sure API keys, ack tokens, ntfy topics and secrets never appear in logs. Tests check this.
4. **Error handling review:**
   - Unexpected errors return a generic 500 problem response with the `requestId`, and full details are logged server-side only.
   - DO failures that reach HTTP handlers are mapped to proper problem responses.
5. **Runbook** (`docs/runbook.md`):
   - how to deploy and roll back (`wrangler rollback` and redeploying a tag)
   - how to apply and verify D1 migrations, and what to do if one fails
   - how to rotate `ACK_SIGNING_KEY` with `kid`, `ADMIN_API_KEY`, a user's API key and an ntfy topic
   - how to renew the Cloudflare API token and the `nudge-a-tron-5000-token` GitHub token before they both expire on 2027-09-27
   - how to read Workers Logs for a `requestId`
   - how to handle a leaked topic or key
6. **Staging soak:** run real reminders on staging for at least a few days with a real ntfy topic. Include a DST-neutral daily reminder and one that crosses quiet hours. Write down what you saw in the PR.

## Out of scope

- New product features: snooze, pause and resume, SMS, clients (M7)
- Custom domains and paid Cloudflare features

## Tests

- **Integration:**
  - Rate-limit behaviour: 429 with `Retry-After`, using the binding's local simulation.
  - The request ID is added and returned.
  - Every new or tightened limit is rejected with a problem response.
- **Unit:** the redaction helper, tested against every sensitive field type.
- **Log hygiene:** a test that captures the log output during an end-to-end flow and checks that no key, token or topic appears in it.

## Acceptance criteria

- [ ] Per-key and per-IP rate limiting are in place for all environments
- [ ] Input limits are reviewed, tightened where needed, and documented in one place
- [ ] Structured logs include IDs and are redacted. The log-hygiene test passes
- [ ] `docs/runbook.md` covers deploy, rollback, migrations, rotating every secret, token expiry and incidents
- [ ] The staging soak is done and its findings are recorded in the PR
- [ ] `npm run coverage` passes
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- What are the rate-limit numbers per key and per IP? Is the binding's 10-second or 60-second window better for each?
- Which log level is right in production, and how long are logs kept on the free plan?
- Is there a way to alert on repeated `SEND_FAILED` events within the $0 budget, or do we check them by hand?

## Post-merge

- The session tags the release **`v0.6.0`**, per the milestone versioning rule in `CLAUDE.md`. This completes the MVP.
- Keep the staging soak reminders running for a while as a canary.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 6: Hardening

Implement `docs/milestones/06-hardening.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
Load `cloudflare:workers-best-practices` and `cloudflare:wrangler` before planning.

## How to start
1. Read `CLAUDE.md`, the milestone spec, `docs/architecture.md` (Security and Observability),
   all ADRs, and the HTTP, DO and adapter code from M3–M5.
2. Propose a short implementation plan: rate-limit design and numbers, the list of limits to
   review, the logging and redaction approach, the runbook outline, the soak plan, new
   dependencies, and your answers to the spec's open questions. Wait for my approval before
   writing code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- Don't run `/code-review` until I say yes to it (see below), and don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do, and any manual steps.

Then, as the last thing in that message and on its own line, ask me whether to run
`/code-review` now. If I say yes, run it, fix what it finds with my approval, and report again.
```
