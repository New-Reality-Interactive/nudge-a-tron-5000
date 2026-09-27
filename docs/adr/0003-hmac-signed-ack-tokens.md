# ADR 0003: HMAC-signed ack tokens

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

To stop a nag, the user acknowledges it. That has to work from the ntfy action button (a background HTTP request with no API key) and from a browser link. So the ack URL must carry its own authorization, while staying unforgeable, scoped to one occurrence, and safe if leaked or prefetched.

## Decision

The ack URL is `/a/{token}`, where `token` is an **HMAC-SHA256** signature over:

```
{ occurrenceId, userId, exp, kid }
```

- **Key.** Held in the Worker secret `ACK_SIGNING_KEY` and never in code or config. `kid` identifies the key, so we can rotate it: new tokens use the new key, and older valid `kid`s are accepted until they expire.
- **Verification.** Recompute and compare in constant time (Web Crypto `crypto.subtle`). Reject a bad signature, an unknown `kid`, or `exp` in the past.
- **Scope.** A valid token acks only its own occurrence, and only while that occurrence is open (`PENDING` or `NAGGING`). Once it's `ACKED` or `MISSED`, the token does nothing.
- **Idempotency.** Acking twice gives the same result as acking once.
- **Prefetch safety.** `GET /a/{token}` only shows a confirmation page. `POST /a/{token}` does the ack. Link unfurlers and mail scanners, which issue GETs, can't ack by accident. The ntfy `http` action button POSTs directly.

We use HMAC instead of stored random tokens because verification needs no database read before routing to the user's DO. `userId` in the payload identifies the DO. Because the payload is signed, a token for one user can't be pointed at another user's DO.

## Consequences

- Revoking a single token early isn't possible. Tokens are short-lived and die when their occurrence closes, which bounds the exposure.
- Rotating the key requires keeping old `kid`s until their tokens expire.
- The token format is versioned by `kid`, so the format can change later.
- `ACK_SIGNING_KEY` must be set per environment with `wrangler secret put ACK_SIGNING_KEY --env <env>`. Locally, it's set in `.dev.vars`.
