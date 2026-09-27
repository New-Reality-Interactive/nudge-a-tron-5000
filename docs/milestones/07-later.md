# Milestone 7: Later (post-MVP backlog)

**Status:** Not planned

These items are deliberately outside the MVP. Each one needs its own spec before it's built: copy the structure of `02`–`06` (Goal, Scope, Out of scope, Tests, Acceptance criteria, Open questions, Post-merge, Kickoff prompt) into a new `08-…md`, `09-…md` and so on. For anything that affects the architecture, start with a planning session, not an implementation session.

## Candidates

- **Twilio SMS adapter:**
  - A second `Notifier` implementation.
  - Inbound replies (e.g. "ACK") routed through a webhook, which needs Twilio signature validation.
  - US sending requires 10DLC registration or toll-free verification.
  - This is the first feature that costs money, so it needs a cost ADR.
- **Snooze:** push the current occurrence's next nag back by a set time without acknowledging it. Needs a domain rule, a new event type, an API route and an ntfy action.
- **Pause and resume:** suspend a reminder without deleting it, and decide what happens to occurrences due while it's paused.
- **Clients:**
  - a CLI
  - a small web UI
  - Apple Shortcuts integration

  All of them use the existing REST API. They may need CORS and a friendlier way to handle keys.
- **Self-hosted ntfy with access tokens:** removes the public-topic caveat from ADR 0002. This is a config and adapter change only.
- **Custom domain:** a nicer URL for ack links. Needs zone-level Workers Routes permission on the Cloudflare token.

## Kickoff prompt: planning session

Use this prompt to turn one candidate into a spec before implementing it:

```markdown
# Task: Nudge-A-Tron 5000 — plan "{{FEATURE}}"

Don't write code in this session. Produce a milestone spec at
`docs/milestones/{{NN}}-{{slug}}.md`, following the structure of `02-domain-core.md`.

1. Read `CLAUDE.md`, `docs/architecture.md`, the ADRs, `docs/milestones/07-later.md`, and the
   code the feature would touch.
2. Ask me the questions you need answered about behaviour, cost and limits.
3. Draft the spec: goal, scope, out of scope, tests, acceptance criteria, open questions,
   post-merge checks, and a kickoff prompt naming the skills to load. Propose an ADR if the
   feature changes the architecture or costs money.
4. Commit it on a `docs/…` branch. Don't push until I say so.
```
