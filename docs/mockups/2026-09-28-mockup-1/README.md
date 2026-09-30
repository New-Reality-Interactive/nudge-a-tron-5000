# Mockup 1: web client

A clickable mockup of the "small web UI" client listed in
[Milestone 8](../../milestones/08-later.md). It shows what a person using Nudge-A-Tron day to day
might see. Most of it uses only the existing `/v0` API. Groups and My Day need small additions,
listed under [Proposed API additions](#proposed-api-additions). It is not a plan or a decision. Building a real
client needs its own milestone spec, and probably CORS and a friendlier way to handle API keys.

Open [`index.html`](index.html) in a browser. It's a single file with no dependencies and makes no
network calls. All the data is fake, and the clock is fixed at Monday 28 Sep 2026, 08:20
(America/New_York), so the story stays consistent.

## What's in it

| View | Shows | API behind it |
|---|---|---|
| **Now** | Occurrences that are nagging, with escalation level, next nag, nags sent against the cap, and ntfy priority. A **Done** button acks one. Also what's coming up in the next 7 days, and what closed in the last 24 hours. | `GET /v0/me`, `GET /v0/reminders`, `GET /v0/reminders/{id}/occurrences`, `POST /v0/occurrences/{id}/ack` |
| **My Day** | Everything due today from every group, in time order. Each item shows its group, strength and status (done, nagging, missed or coming up), and a nagging one has a **Done** button. A "now" line and the quiet-hours edges sit in the timeline. Above it: counts for the day, a progress bar, what's next, and chips to show one group. | Proposed `GET /v0/agenda?date=…`, plus `POST /v0/occurrences/{id}/ack` |
| **Groups** | A card per group: how many of its reminders are due today, how many are nagging, and what's still to come. **+ New group** takes a name and a color. Opening a group lists its reminders in the order they happen today (**Today**), then **Done for today**, **Later** and **Completed**. A reminder due more than once today shows each time, marked done or next. **All reminders** and **No group** use the same layout. **+ New** inside a group preselects that group. | Proposed `GET /v0/groups`, `POST /v0/groups`, `GET /v0/reminders?groupId=…` |
| **Reminder details** | Opens from any list: group (changeable), schedule, RRULE, cap, a chart of the nag schedule, and its occurrence history with each occurrence's audit events. | `GET /v0/reminders/{id}`, `GET /v0/occurrences/{id}/events`, `DELETE /v0/reminders/{id}`, and a proposed `groupId` on `PATCH /v0/reminders/{id}` |
| **New** | A create form, including an optional group. **Repeat** offers presets based on the chosen start (every day, every weekday, every week on Monday, every month on the 28th, every year on 28 Sep) and a **Custom…** builder: "Every [n] [hours / days / weeks / months / years]", day-of-week toggles, monthly by date or by weekday ("the fourth Monday", "the last Monday"), and an end: never, on a date, or after a number of times. It shows a plain-English summary and the next few dates, and builds the RRULE behind the scenes, so nobody has to write one. Also the three strengths and optional give-up limits. A live preview shows the ntfy notification (title only), the nag schedule, when it gives up, and the request body. | `POST /v0/reminders` with an `Idempotency-Key` |
| **Settings** | Time zone and quiet hours, with a 24-hour bar showing the quiet window. Also the stored API key, and a note about the ntfy topic. | `GET /v0/me`, `PATCH /v0/me` |

Turn on the **API** switch in the top bar to label each part of the UI with the call behind it.
Calls that don't exist yet are marked "proposed".
The page follows the system light or dark theme. The sun button switches between them.

## Proposed API additions

Groups and My Day need these. Each one only adds to `/v0`, so it's backwards compatible under
[ADR 0007](../../adr/0007-versioning-and-compatibility.md). None has been designed yet: a real
version needs a milestone spec and probably an ADR.

- **A `groups` resource.** Groups are `{ id, name, color }`, with `GET` and `POST /v0/groups`.
  Renaming and deleting are left out of the mockup. Deleting a group would need a rule for its
  reminders, for example that they become ungrouped.
- **An optional `groupId` on reminders.** It's set on `POST` and `PATCH /v0/reminders`, and a
  `groupId` filter on `GET /v0/reminders`.
- **An agenda.** `GET /v0/agenda?date=YYYY-MM-DD` would list the day's occurrences in the user's
  time zone, both past and still to come. Without it, a client would have to expand RRULEs
  itself and repeat the server's recurrence and DST logic. The mockup does exactly that with a
  small RRULE reader, which is fine for a demo but not for a real client.

## Rules it follows

The mockup uses the real rules, so its numbers match the service:

- **Strength profiles.** Intervals and priorities come from `src/domain/escalation.ts` and
  [ADR 0005](../../adr/0005-escalation-cap-and-quiet-hours-semantics.md). For example, firm
  gives up after 20 nags in about 2.3 hours.
- **Carry-over.** After an occurrence is missed, the next one starts a level higher (see
  "Stretch break").
- **Quiet hours.** Nags due in the window wait until it ends (see "Morning meds").
- **Titles only.** Notifications carry only the title ([ADR 0002](../../adr/0002-ntfy-first-behind-notifier-port.md)).
- **Validation limits.** The form uses the limits in [ADR 0008](../../adr/0008-http-api-conventions.md).

## Layout

- **Phone (below 860px):** a bottom tab bar. Details open as a bottom sheet.
- **Desktop:** a sidebar. Details open as a right-hand drawer.

Checked at 390px and 1280px, with no horizontal scrolling.
