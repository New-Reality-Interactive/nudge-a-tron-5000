# Milestones

The MVP is delivered in milestones. Each has its own spec here, and each is built in its own Claude Code session and its own PR. The overall design lives in [`../architecture.md`](../architecture.md) and the [ADRs](../adr/). These specs break it into pieces that can be built one at a time. If a spec and the architecture disagree, stop and resolve it. Don't guess.

| # | Milestone | Status | Spec |
|---|---|---|---|
| 1 | Scaffold | ✅ Done (`v0.1.0`) | [01-scaffold.md](01-scaffold.md) |
| 2 | Domain core | ✅ Done | [02-domain-core.md](02-domain-core.md) |
| 3 | UserNudger Durable Object | Not started | [03-user-nudger-do.md](03-user-nudger-do.md) |
| 4 | HTTP API + auth | Not started | [04-http-api-auth.md](04-http-api-auth.md) |
| 5 | Ack flow + ntfy adapter | Not started | [05-ack-flow-ntfy.md](05-ack-flow-ntfy.md) |
| 6 | Hardening | Not started | [06-hardening.md](06-hardening.md) |
| 7 | Later (post-MVP backlog) | Not planned | [07-later.md](07-later.md) |

Milestones depend on each other in order. Don't start one until the previous one is merged.

## How to run a milestone

1. **Start a new Claude Code session** in the repo, on an up-to-date `main`. `CLAUDE.md` loads automatically. It covers the engineering rules, the constraints and the git workflow.
2. **Paste the milestone's kickoff prompt.** It's the "Kickoff prompt" section at the bottom of each spec, and it names the skills to load.
3. **Review the plan.** The session reads the spec and the relevant code, then proposes a plan and waits. Push back on anything unclear before you approve it.
4. **Let it implement.** It works on a `feat/…` branch, commits in logical groups, and runs typecheck, lint and tests before every commit.
5. **Review the code.** Once implementation is done, ask for `/code-review` and have the session fix what it finds.
6. **Say "push".** The session pushes, opens a PR following the template, watches `verify`, and gives you the URL.
7. **Review and merge** in the GitHub UI. Merging to `main` deploys to staging unless only docs, tests or config changed.
8. **Do the post-merge checks** listed in the spec, such as a staging smoke test or checking a migration ran.
9. **Release to production when it makes sense:** tag `vX.Y.Z` on `main`. That deploys to production after CI passes.

Each PR also updates its own spec. It changes the **Status** line, ticks the acceptance criteria, and updates the table above. The docs then show what has actually shipped.

## Kickoff prompt template

Each spec has a ready-made copy of this prompt. For a milestone without one, fill in the blanks:

```markdown
# Task: Nudge-A-Tron 5000 — Milestone {{N}}: {{NAME}}

Implement `docs/milestones/{{FILE}}.md`. That spec is the scope. Follow `CLAUDE.md`.

## Skills
{{e.g. Load `cloudflare:durable-objects` and `cloudflare:wrangler` before planning.}}

## How to start
1. Read `CLAUDE.md`, the milestone spec, `docs/architecture.md`, the ADRs it links, and the
   relevant code.
2. Propose a short implementation plan: files, key types and functions, test strategy, any new
   dependencies (latest versions, and whether they need install scripts), and answers or
   proposals for the spec's open questions. Wait for my approval before writing code.

## Rules for this session
- Stay inside the spec's scope. If the spec is ambiguous or turns out to be wrong, stop and ask.
- A significant new decision gets an ADR in `docs/adr/`.
- In the same PR, update the spec's Status and acceptance checklist, and the table in
  `docs/milestones/README.md`.
- When implementation is complete, tell me it's ready for `/code-review`. Don't push until I say so.

## When done, report
What was built, commits, typecheck/lint/test/coverage results (with output), deviations from
the spec and why, new dependencies, the post-merge checks I need to do, and any manual steps.
```
