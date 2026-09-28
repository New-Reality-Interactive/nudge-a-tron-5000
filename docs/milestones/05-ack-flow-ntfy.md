# Milestone 5: Ack flow + ntfy adapter

**Status:** Not started
**Depends on:** Milestone 4
**Branch:** `feat/ack-flow-ntfy`

## Goal

Send real notifications and let people stop them. Nags go to the user's phone through ntfy, and each one carries a button that acknowledges the occurrence with a signed, single-purpose token. This completes the full loop: create a reminder, it nags, it escalates, the user taps ack, and it stops.

## Scope

1. **Ack tokens** (`src/adapters/crypto/AckToken.ts`), per [ADR 0003](../adr/0003-hmac-signed-ack-tokens.md):
   - An HMAC-SHA256 signature over `{occurrenceId, userId, exp, kid}`, computed with `crypto.subtle`.
   - The key is `ACK_SIGNING_KEY`.
   - `kid` selects the signing key. Support a current key plus older keys that are still valid, so the key can be rotated.
   - Verification rejects a bad signature, an unknown `kid` or an expired token, and compares in constant time.
   - The token is URL-safe (base64url).
   - **The token starts with a format marker**, for example `a1.`, separate from `kid`. ADR 0007 requires ack links already sent to keep working, so a future token format must be told apart from this one and verified alongside it. Tokens sent without a marker could never be told apart later.
2. **Public ack routes** (no API key):
   - `GET /a/{token}`: a minimal HTML confirmation page with a POST form. It never acknowledges anything, so link previews and prefetchers can't trigger it.
   - `POST /a/{token}`: verifies the token, routes to the user's DO with `idFromName(userId)`, and acknowledges the occurrence.
   - Both are **idempotent**. Acknowledging an occurrence that's already acked or closed returns a friendly "already done" response, not an error.
   - An invalid or expired token returns a generic failure that doesn't reveal why.
3. **Ntfy notifier** (`src/adapters/ntfy/NtfyNotifier.ts`), which implements the `Notifier` port from M3:
   - It publishes to the user's topic on ntfy.sh.
   - The priority comes from the escalation level (M2).
   - Each notification has an `http` action button that POSTs to `/a/{token}`, plus a `view` action that opens the confirmation page as a fallback.
   - **Titles only by default** ([ADR 0002](../adr/0002-ntfy-first-behind-notifier-port.md)). The body is never sent unless a reminder explicitly allows it.
   - Any field added to the outbox `Notification` payload, such as the body opt-in, must be optional when read. Outbox rows written by an earlier release can still be pending when the new code delivers them (ADR 0007, add-only).
4. **ntfy topics:** each user gets a random 128-bit topic, created along with the user. It's shown to that user only through `GET /v0/me`, never logged, and never returned on any other route.
5. **Wiring:** in production, the DO builds its notifier from `NtfyNotifier`. The base URL comes from config, so it can point at a self-hosted ntfy later.

## Out of scope

- The Twilio SMS adapter (the post-MVP backlog, [08-later.md](08-later.md))
- Rate limiting (M6)

## Tests

- **Unit:**
  - Token signing and verification round trip.
  - Tampered payload, tampered signature, wrong `kid`, expired token.
  - Rotation: a token signed with the old key still verifies.
  - The ntfy request builder produces the right URL, headers, priority and actions, with no body by default.
- **End-to-end integration** in workerd, with outbound `fetch` to ntfy mocked:
  1. Create a user, a key and a reminder through the API.
  2. Advance the controlled clock and run the DO alarm. Check the sequence of ntfy requests, including the intervals and priorities.
  3. Take the ack URL from a captured ntfy request and POST to it. The occurrence is `ACKED`.
  4. Run the alarm again. There are no more ntfy requests for that occurrence.
  5. Replay the same alarm. Nothing is sent twice.
  6. `GET /a/{token}` returns the confirmation page and doesn't acknowledge. A second POST is idempotent. An expired or tampered token fails.

## Acceptance criteria

- [ ] Ack tokens follow ADR 0003, including `kid` rotation and constant-time verification
- [ ] `GET` confirms and `POST` acknowledges. Both are idempotent, and an ack can't be triggered by prefetching the link
- [ ] The ntfy adapter sends titles only by default, maps levels to priorities, and includes an ack action button
- [ ] The topic is only exposed through `/v0/me` and is never logged
- [ ] The end-to-end test passes. `npm run coverage` passes
- [ ] This spec's Status is set to Done and `docs/milestones/README.md` is updated

## Open questions (answer them in the plan)

- How long is a token valid (`exp`)? For example, until the occurrence's cap deadline plus a margin.
- Where do older signing keys live: extra secrets such as `ACK_SIGNING_KEY_<kid>`, or one JSON secret?
- Should users be able to rotate their own topic, or should rotation be admin-only for now?

## Post-merge

- **Manual end-to-end test on staging:**
  1. Subscribe to your staging user's topic in the ntfy app on your phone.
  2. Create a `relentless` reminder one minute from now.
  3. Watch it escalate, then tap the ack button. Nagging should stop.
- Tag a release once staging looks right. From here on, the service does something useful.

## Kickoff prompt

```markdown
# Task: Nudge-A-Tron 5000 — Milestone 5: Ack flow + ntfy adapter

Implement `docs/milestones/05-ack-flow-ntfy.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
Load `cloudflare:workers-best-practices` and `cloudflare:durable-objects` before planning.

## How to start
1. Read `CLAUDE.md`, the milestone spec, ADRs 0002 and 0003, `docs/architecture.md`, the
   `Notifier` port and fake adapter from M3, and the HTTP layer from M4.
2. Propose a short implementation plan: the token format and key handling, the ack routes and
   confirm page, the ntfy request format, the topic lifecycle, the end-to-end test design, new
   dependencies, and your answers to the spec's open questions. Wait for my approval before
   writing code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- Never log tokens, topics or signing keys.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- Don't run `/code-review` until I say yes to it (see below), and don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do (including the manual
phone test on staging), and any manual steps.

Then, as the last thing in that message and on its own line, ask me whether to run
`/code-review` now. If I say yes, run it, fix what it finds with my approval, and report again.
```
