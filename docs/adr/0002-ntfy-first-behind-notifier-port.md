# ADR 0002: ntfy first, behind a `Notifier` port

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Nags have to reach a phone, be free to send, and support escalation. Later we want SMS (Twilio) too, which costs money and needs 10DLC or toll-free verification. The ack has to work from the notification itself.

[ntfy.sh](https://ntfy.sh) is a free, open-source HTTP pub/sub push service with iOS and Android apps. A publish is one HTTP request. It supports priorities 1–5 and **action buttons**, including an `http` action that sends a request without opening a browser.

## Decision

- Define a **`Notifier` port** in `src/app`. The domain and use cases depend only on the port, never on a specific channel.
- Ship **`NtfyNotifier`** (`src/adapters/ntfy`) as the first and only adapter for the MVP. Escalation maps to ntfy priority, e.g. `firm` goes from 3 to 5.
- Each notification includes an ack action button. It POSTs a signed ack token (see [ADR 0003](0003-hmac-signed-ack-tokens.md)) to `/a/{token}`.
- A Twilio SMS adapter is a later milestone, added behind the same port.

## Public-topic caveat

**Anyone who knows a public ntfy.sh topic name can read it.** Topics have no authentication by default. Mitigations:

- **Unguessable topics.** Each user's `ntfyTopic` is 128 bits of randomness. It's treated as a secret: never logged and only shown to its owner.
- **Titles only by default.** Notifications carry the reminder title but not its body, so a leaked topic exposes as little as possible.
- **Short-lived ack links.** Tokens expire and only work while the occurrence is open, so a leaked notification can't be used to ack later reminders.
- **Upgrade path.** A self-hosted ntfy server with access tokens (or ntfy.sh reserved topics with auth) removes the caveat. It only needs adapter configuration, with no domain changes.

Users must be told this plainly during onboarding. Don't put anything sensitive in a reminder title.

## Consequences

- Costs $0 and needs no account for the MVP.
- Tests can assert exact outbound requests (URL, priority header, action payload) with a mocked `fetch`, which keeps the escalation sequence deterministic and testable.
- The outbox and retry logic sits above the port, so every adapter gets idempotent delivery.
- Delivery depends on a third-party service. Failed sends are recorded as `SEND_FAILED` events and retried with backoff.
