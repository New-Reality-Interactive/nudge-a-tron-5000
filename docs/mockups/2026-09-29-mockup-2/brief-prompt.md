# Task: Reverse-engineer a product brief from the Nudge-A-Tron mockup

You're writing a **product brief** for Nudge-A-Tron as if it were a new product that has not
been built yet. It covers two products that ship together:

1. **The Nudge-A-Tron app:** the website first, then an iOS app.
2. **The Nudge-A-Tron API:** a companion product that everything the app does is built on.

The finished app should be what the latest mockup shows, plus the few additions listed under
**Decisions**. Work backwards from the mockup to the products: the problem they solve, who
they're for, what they do, how they're released in stages, and what's still undecided.

This session is for writing the brief only: no code, and no changes to the mockup.

## Read first

1. `CLAUDE.md`, including the git workflow. Work on a new `docs/…` branch from an up-to-date
   `main`, and don't push until I say so.
2. **The mockup (the source of truth for the end state):**
   `docs/mockups/2026-09-29-mockup-2/index.html` and its `README.md`. Open `index.html` in a
   browser if you can, and read the README fully: it explains every feature and the reasons
   behind it. The published copy is https://claude.ai/artifact/SY3La1zBKAiP1biEzwvpJR.
3. **The current service, as background only:** `docs/architecture.md`, `docs/adr/`,
   `docs/milestones/`. The mockup deliberately goes beyond this architecture. For example,
   there's no ntfy, urgency replaces priority, and nags go to several notification targets.
   Where they differ, **the mockup and the decisions below win**. Keep the existing product
   ideas that still hold, such as signed acknowledgement links, quiet hours, carry-over, the
   safety cap and deterministic escalation. List the differences in an appendix; don't treat
   them as problems.

**Don't base anything on the existing API or its documentation.** Ignore:
- `openapi/`
- the `/v0` routes and conventions in `docs/architecture.md`, ADR 0007 and ADR 0008
- the "API behind it" and "Proposed API additions" sections in the mockup READMEs
- the API calls in the mockups' code and messages

Design the API from what the mockup's screens and behaviors need, as if nothing existed.

Some things in the mockup are demo scaffolding, not product features:
- the "Mockup: preview as" switch, whose Android option also doesn't apply (see below)
- the fixed clock (Mon 28 Sep, 08:20)
- the made-up data
- "any 6 digits work"
- the admin-issued API key in Settings, which sign-in replaces (see below)

## Decisions (already made: don't reopen them)

### Releases and platforms

- **v0 (website).** Manage everything in the browser: reminders, groups, My Day, editing,
  settings and accessibility. Nags go **only by email and SMS**. The website never sends
  notifications itself.
- **v1 (iOS app).** Adds device notifications. I'll pay the Apple Developer fee.
  - **Early nags** are **Time Sensitive notifications** with **Snooze, Done and Dismiss**
    actions: little friction, and they get through Focus.
  - **The final step** is an **AlarmKit alarm (iOS 26 and later)**, the "can't miss it" step:
    full screen on the Lock Screen, sounds through silent mode, with **Done** and **Snooze**.
  - **Fallback for iOS 18 and earlier** (Apple went from 18 to 26): once a nag reaches the
    Urgent stage, send a **Time Sensitive notification every minute, up to 10**. Then go back to
    the strength's normal Urgent interval until the give-up limit.
- **Android: not planned.** It's out of scope, with no trigger for doing it. Remove Android from
  the release plan and from the mockup's platform options. Just avoid making the API
  iOS-specific where a neutral design costs nothing.

### Audience, accounts and money

- **Audience:** start small and go public later. v0 and v1 are for me and people I invite. The
  brief must say **what has to be true before opening it to the public**, for example abuse and
  cost controls, support, and privacy and legal readiness.
- **Accounts:** by **email invitation**. An existing user or an admin invites someone, and they
  accept through a link and set up sign-in. There's no open sign-up in v0 or v1.
- **Sign-in:** **passkeys**, on the website and in iOS. The brief must define **account recovery
  if a passkey is lost** (see open questions).
- **Business model:** **free; I cover the costs.** Budget caps replace pricing. There's no
  billing and no in-app purchase.

### The API

- **Only Nudge-A-Tron's own apps use it:** the website, the iOS app, and the email and SMS
  acknowledgement links. There are no third-party keys or developer portal, but the contract is
  still written and published internally.
- **Contract format:** **OpenAPI 3.1**, for REST over HTTPS.
- **Contract first:** in every release, **the API contract is finished and agreed before any
  interface work starts.** The implementation can be stubbed or mocked, but the contract has to
  cover everything that release's screens need.

### Notifications and cost

- **SMS: US only,** so 10DLC or toll-free verification and STOP and HELP handling.
- **SMS budget:** a **small monthly cap for everyone together, about $10–20**, plus a **daily
  text limit per person**. When a cap is reached, texts **fall back to email** and the person is
  told. Propose the actual numbers.
- **Hosting:** near-free on **Cloudflare**: Workers, Durable Objects and D1 free tiers. The only
  paid items are the Apple fee, SMS, and an email sender if one is needed.

### Snooze and Dismiss

- **Snooze length is fixed by strength:** Gentle 30 minutes, Firm 15, Relentless 5.
- **Snooze rules:**
  - Snooze **pauses** the nagging clock: snoozed time doesn't count toward the time limit.
  - Snooze **doesn't raise** the escalation level.
  - It's allowed **3 times per occurrence**. After that, Snooze disappears from notifications
    and alarms.
- **Dismiss only clears the notification.** The next nag still arrives on schedule and still
  escalates. Only **Done** stops nagging. Acknowledging in one place stops nagging everywhere.

### Data and scope

- **Retention:** occurrences and their events are kept **90 days**, then deleted automatically.
  Deleting a reminder or an account deletes its data.
- **Added to v0–v1 scope, beyond the mockup:**
  - **Account deletion and data export,** self-service. App Store rules also require deleting an
    account from inside the iOS app.
  - **Pausing and resuming a reminder.** It's new, so define its behavior, including what
    happens to occurrences due while it's paused.
- **English only** in v0 and v1, with text written so it can be translated later.

## What the brief must cover

Keep it short and product-level: what and why, not how.

### The app

1. **Problem and audience.** Who needs reminders that keep nagging until they're acknowledged,
   and why ordinary reminders fail them. Use the "start small, go public later" decision.
2. **Product concepts,** in plain language:
   - reminder, occurrence and nag
   - strength (Gentle, Firm, Relentless) and escalation level
   - **urgency** (Normal, High, Urgent)
   - the give-up limit (cap), quiet hours, and carry-over after a missed occurrence
   - groups and My Day
   - notification targets, and routing by urgency ("Which nags")
   - Snooze, Dismiss and Done
   - pausing a reminder
3. **Features by release** (v0 and v1), traced to the mockup's screens and the decisions above,
   with what's left out of each.
4. **How nagging works in each release:**
   - **v0 has only email and SMS.** Explain how nagging stays useful within the SMS caps, given
     that email is slow and noisy for repeated nags. The mockup's defaults: email gets the first
     nag and a note if it's missed; SMS gets Urgent nags only.
   - **v1 on iOS.** How urgency and escalation map to Time Sensitive notifications, the AlarmKit
     alarm, and the iOS 18 chain. Also how Snooze and Dismiss behave in each.
5. **Principles that hold across releases:**
   - accessibility to WCAG 2.1 AA (the mockup README explains how it gets there)
   - privacy: notifications show only the title
   - times shown in the person's chosen format (12-hour, 24-hour or UTC)
   - behavior that's predictable and can be tested

### The API (companion product)

6. **Purpose and users,** as decided: Nudge-A-Tron's own apps only.
7. **What it must provide, derived from the mockup and the decisions.** Work screen by screen, and
   list the capabilities each needs, grouped by release. This is capability level: resources and
   operations in plain language, not full endpoint definitions. At least:
   - **invitations and passkey sign-in,** including recovery
   - **reminders:** create, edit (sending only the changes), pause and resume, delete, list and
     search, per group
   - **occurrences and their event history:** acknowledge (Done)
   - **what's due today across groups:** My Day
   - **groups**
   - **the escalation preview** the forms show: nag schedule, give-up point, and where nags go
   - **settings:** time zone, quiet hours
   - **notification targets:** add, verify by code, switch on and off, choose which nags, send a
     test, remove
   - **SMS caps:** usage, and falling back to email
   - **acknowledging from outside the app:** email and SMS links
   - **account deletion and data export**
   - **v1 additions:** registering devices; the notification actions (Snooze with its limit,
     Done, Dismiss); scheduling and cancelling alarms; the iOS 18 chain
8. **Contract-first delivery:**
   - Define what "contract complete" means for a release, for example: an OpenAPI 3.1 document
     covering every capability for that release, including errors and validation limits,
     reviewed and agreed.
   - Explain how the interface is built and tested against it before the implementation is
     done, for example against mock servers or stubbed responses.
9. **API principles:**
   - passkey sign-in and sessions for the website and the iOS app
   - versioning and backwards compatibility, since older iOS app versions stay in use for a
     long time
   - consistent errors
   - safe retries, so a repeated request doesn't act twice
   - pagination
   - time zones and times
   - rate limits
   - the 90-day retention

### Both

10. **Success measures** for v0 and v1, for the app and the API.
11. **Costs and constraints:** Cloudflare free tiers, the Apple fee, the SMS caps, the email
    sender. Include an estimate of monthly cost at the invite-only scale.
12. **Criteria for going public,** as decided above.
13. **Risks and open questions.** At least:
    - The **AlarmKit cancellation risk.** The phone schedules alarms itself, so a nag
      acknowledged by email, SMS or on another device must cancel the alarm on the phone, or it
      rings after the reminder is done. Check Apple's AlarmKit documentation for what's actually
      possible, and cite it. Say what this means for the API.
    - SMS compliance (10DLC or toll-free, STOP and HELP), and choosing an SMS provider within
      the budget.
    - Whether email reaches inboxes, and choosing an email sender within the hosting
      constraint.
    - Recovering a lost passkey.
    - Keeping the API contract stable while older iOS app versions are in use.
14. **Appendix:** where the brief departs from `docs/architecture.md` and the ADRs, apart from the
    API, which is designed from scratch. List the ADRs it would probably need.

## How to work

- If the `bmad-method:bmad-product-brief` skill is available, use it.
- The decisions above are final. Only ask me about things that are still open:
  - **Passkey recovery.** Recommend an approach, for example a recovery link by email, or
    another passkey registered in advance.
  - **The exact SMS caps.** Propose the monthly budget and the per-person daily limit.
  - **What pausing does to occurrences due while paused.** Recommend: skip them, don't nag.
  - **Who can send invitations:** any user, or only an admin.
  - **Anything else you find missing.**
- Save the brief as `docs/product/brief.md`, and commit it on your `docs/…` branch with a
  Conventional Commit message.
- When you're done, give me the path, a short summary, and the open questions still unresolved.
