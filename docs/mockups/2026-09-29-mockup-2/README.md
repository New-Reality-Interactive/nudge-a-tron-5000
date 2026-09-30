# Mockup 2: accessible web client

This is [mockup 1](../2026-09-28-mockup-1/README.md), with its groups and My Day, reworked to meet
**WCAG 2.1 Level AA**. That's the standard the ADA rules for web content use (the DOJ's 2024 Title
II rule) and the usual target for ADA compliance in the private sector. The screens, data and
proposed API additions are the same as in mockup 1, so read that README for what each view does.
This one covers what changed for accessibility, and how it was checked.

Open [`index.html`](index.html) in a browser. It's still a single file with no dependencies.

Unlike mockup 1, this one has no **API labels** switch. It shows only what a person using the
app would see. Mockup 1's README lists the API calls behind each view.

## What changed

### Seeing it

- **Color contrast (1.4.3, 1.4.11).**
  - Light mode darkens the accent, strength, status, quiet-hours and group colors so all text
    reaches 4.5:1. Mockup 1 failed this in 78 places, mostly the orange accent and the colored
    badges.
  - Form controls get a new `--control` border color that reaches 3:1 against the page in both
    themes. Before, input borders were about 1.3:1.
  - Dark mode already passed and is unchanged apart from control borders.
- **Not color alone (1.4.1).** Every status has words as well as a color:
  - The time chips on a group's Today list say "(done)", "(nagging)" or "(next)" to screen
    readers.
  - Coming-up items on My Day say "Coming up", and nagging items on group cards say "(nagging)".
  - Group colors always appear next to the group's name.
- **Text size (1.4.4) and reflow (1.4.10).**
  - Font sizes are in `rem`, so browser text zoom and the new text-size setting both scale them.
  - Text wraps instead of being cut off with "…".
  - Every view fits a 320px-wide screen at the largest text size without scrolling sideways. The
    strength cards wrap, the day's counts wrap, and on narrow screens a My Day row's Done button
    moves under the reminder.
- **Display settings** (Settings › Display on this device, saved in the browser):
  - **Text size:** Default, Large (112.5%) or Larger (125%).
  - **More contrast:** secondary text becomes full-strength text, borders get darker, and the focus
    ring gets thicker.
  - **Reduce motion:** turns off every animation and transition. The page also follows the
    system's reduced-motion setting.
- **Motion (2.2.2).** The pulsing dot on a nagging reminder stops after three beats.

### Using a keyboard

- **Skip link (2.4.1).** The first Tab stop is "Skip to main content".
- **Focus you can see (2.4.7).** A 3px focus ring in the accent color (3:1 or better), and 4px
  with More contrast. Group cards show the ring around the whole card.
- **Focus isn't hidden.**
  - On phones the top bar scrolls away instead of staying fixed over the content.
  - Scroll padding keeps focused fields clear of the fixed bars.
- **Focus goes somewhere sensible** after anything that removes or replaces what had it:
  - Changing view moves focus to the new view's heading.
  - Opening a reminder moves focus into the details panel. Escape or Close returns it to the row
    you opened it from.
  - After **Done**, focus moves to the next Done button, or to the heading when none are left.
  - Delete asks for confirmation on the page and puts focus on "Keep it". After a delete, focus
    moves to the heading.
- **The details panel is modal.** While it's open the rest of the page is `inert`, so Tab and a
  screen reader's browse mode stay inside it.

### Using a screen reader

- **Page titles (2.4.2).** Each view sets the page title, for example "Health · Nudge-A-Tron".
- **Headings and landmarks (1.3.1).**
  - Every view has one `h1`. Sections, group cards, settings panels and parts of the details panel
    have headings.
  - Each group card's title is a link in an `h2`, so the heading list works as a list of groups.
- **Names that make sense out of context (2.4.6, 2.5.3).**
  - Repeated buttons name their reminder: "Done, stop nagging: Take the bins out", "Details: Take
    the bins out", "Done: Reply to Alex about the lease". Each name starts with the visible label.
  - The theme button says what it will do ("Switch to dark theme").
- **Decorative symbols are hidden.** Screen readers skip emoji and arrows (🌙 ✓ ↻ ›). Where one
  carries meaning, it's replaced with words.
- **Status messages (4.1.3).**
  - Toasts use `role="status"` and stay for 6 seconds.
  - A hidden live region announces changes that don't move focus: search result counts, the My Day
    group filter, and display-setting changes.
- **Forms (3.3.1, 3.3.2).**
  - The title is marked required.
  - Hints are linked to their fields with `aria-describedby`, and each invalid field is marked and
    linked to its message.
  - Submitting with problems shows an error summary at the top of the form and moves focus to it.
    Each entry links to its field.

## Where nags are sent

**The website manages; it never notifies.** Nags go to three kinds of target:
- **Email addresses**
- **Mobile numbers, by SMS**
- **Phones with the native Nudge-A-Tron app**, as device notifications

Settings › **Where nags are sent** lists every target. You can have as many email addresses and
numbers as you like. Each target has:
- a **Send nags here** switch
- **Which nags**: every nag, High and Urgent nags, Urgent nags only, or the first nag and if it's
  missed
- **Send a test**
- **Remove**, which asks for confirmation on the page

The defaults keep costs and inbox noise down:

| Target | Default | Why |
|---|---|---|
| Phone with the app | Every nag | the channel built for nagging |
| Email | First nag, and if it's missed | email is too slow and noisy for repeated nags |
| SMS | Urgent nags only | texts cost money and can be blocked as spam if frequent |

**Adding email or SMS** sends a 6-digit code, which you enter on the page (any 6 digits work in the
mockup). **Phones can only be added from the app**: the website lists them, and you can switch
them off, change which nags they get, or remove them. If nothing is switched on, Settings, and
each reminder's "Where nags go", warn that nags won't reach you.

**Mockup: preview as Website, iPhone app or Android app.** The same screens run in the website
and the apps. This switch shows what changes:
- **Website:** phones are listed as "added from the app", with a prompt to install it.
- **iPhone app:** shows **This iPhone**, with **Ring like an alarm when Urgent**. That uses
  AlarmKit (iOS 26 and later), which sounds even in silent mode and during Focus. iPhone asks for
  permission the first time. Older iPhones get a Time Sensitive notification instead.
- **Android app:** shows **This phone**, with **Allow in Android settings** so Urgent nags can
  break through Do Not Disturb.

On the website, these device-only options show as read-only text: "Change this in the app on
that iPhone".

**Where nags go.** Reminder details and the New form summarize, for that reminder's strength and
give-up limits, which targets its nags reach. For a firm reminder:
- Email gets the first nag, and a note if it's missed.
- SMS gets nags from nag 4, when it's Urgent (17 texts).
- The iPhone gets every nag (20 notifications), and the Urgent ones ring as an alarm.

For a gentle reminder, SMS gets "nothing: this strength never reaches Urgent".

**Proposed direction (beyond the current architecture).** Today the service has one channel,
ntfy. This design would need:
- a per-user list of notification targets, with email and phone verification
- a routing step that picks targets by each nag's urgency, sending a missed note to "first nag"
  targets
- Apple Push Notification service and Firebase Cloud Messaging delivery for the apps, plus an
  email sender and an SMS provider (SMS costs money and needs US 10DLC or toll-free registration)
- store accounts for the apps ($99 a year for Apple, $25 once for Google), which ends the $0
  hosting target
- acknowledging in one place clearing notifications on the other devices

**Open risk with AlarmKit:** the app schedules alarms on the phone; they aren't sent from the
server. If a nag is acknowledged somewhere else, by email, SMS or another device, the iPhone has
to hear about it in time to cancel the alarm. Otherwise it rings after the reminder is done.
Check this against Apple's documentation before designing the service side.

## Urgency instead of ntfy priority

The mockup doesn't depend on any notification technology. It never mentions ntfy, and ntfy's
P1–P5 priority numbers are gone.

A nag escalates in two ways: it comes more often, and it gets more insistent. The second part
is now shown as **Urgency**, with three levels any notification channel can map to its own scale:

| Urgency | Meaning | Today's profile value |
|---|---|---|
| **Normal** | a standard notification | 3 |
| **High** | more prominent, where the device supports it | 4 |
| **Urgent** | the most insistent the device allows | 5 |

It's called "urgency" rather than "priority" because, in reminder apps, priority usually means
how important a task is, and the person sets it. This one is calculated, and it rises while a
nag goes unanswered.

**Where it shows:**
- nag cards ("Urgency: High", "Urgent from the next nag")
- the last column of the "How it nags" charts
- the event history ("level 1 · urgency Normal")
- the notification preview

An ⓘ tooltip next to the Urgency label, and in each chart's note, defines the three levels.

**Other wording changes:**
- The notification preview is a generic "Nudge-A-Tron" notification, noting that notifications
  show only the title and notes stay in the app.
- Settings says nags go to "the notification app your admin connected to your account".

**This goes beyond the documented architecture, on purpose.** The service still uses ntfy's
scale: `src/domain/escalation.ts`, ADR 0005's table, and `priority: 3–5` on `/v0` `NAG_SENT`
events. To follow the mockup, the service's notification step would pass an abstract urgency
(Normal, High, Urgent), and each channel would map it (ntfy 3/4/5, iOS interruption levels,
Android importance, an email importance header, SMS wording). That needs an ADR.

Within `/v0`, `priority` can't be renamed or removed (ADR 0007), but an `urgency` field could be
added alongside it.

## Editing a reminder

A reminder's details panel has an **Edit** button. It opens the reminder form, titled "Edit
reminder", with the reminder filled in, and **Cancel** and **Save changes** buttons.

- **Only changes are sent.** Saving sends `PATCH /v0/reminders/{id}` with just the fields that
  changed, as ADR 0008 requires. Clearing the notes sends `body: null`, and `cap` goes whole. The
  preview's **Changes to send** section shows exactly what will go, or "No changes yet". Saving
  with nothing changed says so and stays on the form.
- **The schedule loads into the same Repeat options.** It matches a preset ("Every week on
  Monday") or the Custom builder (every Monday and Thursday). A rule the builder can't express,
  such as Stretch break's three times a day, appears as **Keep current: …** and is sent back
  unchanged unless you pick another option.
- **What an edit affects matches the service** (`updateReminder` in `src/app/reminders.ts`):
  - A new schedule moves the next occurrence.
  - An occurrence that's nagging now keeps nagging. The form says so for a reminder that's nagging.
  - A new strength or give-up limit applies from the next nag.
  - A completed reminder given a future time becomes active again.
- **Validation and focus work as in New:**
  - Problems are listed in the error summary.
  - Opening the form moves focus to its heading.
  - Cancel returns to where you were and reopens the details.
  - Saving goes to the reminder's group and opens its updated details.

## Nagging cards

The cards on Now are all the same size, however much detail each has:
- Every card in the grid is as tall as the tallest one, including in the one-column phone layout.
- The top of each card has fixed slots: the title (up to two lines), the group and due time, and
  one line for notes, which stays even when a reminder has no notes.
- The escalation bar, stats and buttons are pinned to the bottom, so they line up across cards.

Long titles and notes end with "…". The full text is still in the page for screen readers, the
buttons' names include the full title, and Details shows everything.

## Tooltips on the quiet-hours and starts-higher icons

Every 🌙 and ↑ icon has the same tooltip:

- **🌙 Quiet hours:** "Nags due during your quiet hours wait until they end." It appears on the
  quiet-hours chip on Now, reminders due in quiet hours (in Coming up, My Day and group pages),
  My Day's "Quiet hours end" and "Quiet hours start" markers, and the New form's quiet-hours hint.
- **↑ Starts higher:** "The last one was missed, so this one starts at a higher nag level." It
  appears in Coming up.

They follow WCAG 1.4.13 (content on hover or focus):
- They appear on mouse hover and on keyboard focus.
- You can move the pointer onto the tooltip without it disappearing.
- They stay until the pointer or focus leaves.
- Escape dismisses one without moving focus.
- On touch screens, a tap opens a tooltip and tapping anywhere else closes it.

Each icon is its own button, 24px or larger. Screen readers announce it by name ("Quiet hours",
"Starts higher") with the tip as its description.

A button can't contain another control, so the rows in Coming up, My Day and group pages are no
longer single buttons. Each reminder's title is the button, and its click area still covers the
whole row, as on the group cards. Icons and My Day's Done button sit above that area.

## Time format

Settings › Display on this device has a **Time format** option, saved in the browser:

- **12-hour** (the default): 8:20 AM
- **24-hour:** 08:20
- **UTC:** 12:20 UTC

Every time in the app follows it: the header, nag cards, lists, My Day, group pages, the details
panel and its event history, the New form's summary and next dates, the notification preview,
quiet hours and the 24-hour bar in Settings. Each option shows the current time in that format.
Changing the format keeps focus on the option you picked and announces the change.

**How UTC works.**
- Reminders are still scheduled in the user's time zone (ADR 0004), so UTC mode converts each
  time for display only. It shows the date it falls on in UTC, which can be the next or previous
  day. Schedule sentences move their weekday or date to match: a reminder at 10:30 PM every
  Monday in New York reads "Every Tuesday at 02:30 UTC".
- Recurring schedules are converted using the next occurrence's date. Their UTC time changes by
  an hour when the time zone changes its clocks, and the details panel says so.
- Now shows a "Times shown in UTC" chip.
- The quiet-hours From and Until fields stay in the user's own time zone. The summary under them
  shows the window in UTC and says so.

**Native pickers.** The date and time pickers (First time, From and Until) are the browser's own,
so they follow the device's locale, not this setting.

Schedule sentences are now generated from each reminder's rule, instead of stored as text, so
they follow the setting too.

**Proposed API change.** Today this is a per-browser display preference. If it should follow the
user across devices, it could be an optional `timeFormat` field on `GET` and `PATCH /v0/me`,
which is a backwards-compatible addition.

## How it was checked

- **Automated:** [axe-core](https://github.com/dequelabs/axe-core) 4.10 with the WCAG 2.0 and 2.1 A
  and AA rules. It covered every view, the custom repeat builder and the details panel, in light
  and dark, and again with More contrast and Larger text, and in UTC with Larger text, including the edit form. Result: no
  violations. Mockup 1 had 78,
  all color contrast in light mode.
- **Contrast:** every text and background pair in the palette was measured against WCAG's
  formula in both themes.
- **Scripted in headless Chrome:**
  - the skip link and the order of Tab stops
  - page titles and heading focus when changing view
  - focus into and back out of the details panel, and the rest of the page being inert
  - focus after Done and after the delete confirmation
  - the error summary and its links
  - the display settings being applied and announced
  - editing: how each kind of schedule loads, only changed fields being sent, saving with no
    changes, Cancel, validation, a nagging reminder, and a completed one becoming active again
  - every tooltip (Now, My Day, group pages, New form) on click, keyboard focus and Escape; rows
    still opening their details when clicked anywhere; My Day's Done button still working; and
    open tooltips staying on screen at 320px with Larger text
  - no sideways scrolling at 320px with Larger text, including in UTC
  - in each time format, every view and the details panel scanned for times in the wrong format
    (none), UTC conversion (8:20 AM New York time is 12:20 UTC), and weekday shifts across
    midnight UTC
- **Not yet checked:**
  - real screen readers (VoiceOver on macOS and iOS, NVDA or JAWS on Windows, TalkBack on Android)
  - Windows High Contrast (forced colors)
  - voice control
  - testing with disabled users

  Automated tools find only part of WCAG's issues, so do these before claiming conformance for a
  real client.

## Known gaps

- **No custom forced-colors styles.** In Windows High Contrast the page falls back to system
  colors. Color-only decorations such as the timeline dots and bars disappear, but their text
  remains.
- **The Custom repeat builder re-renders as you change it.** Focus is put back on the control you
  were using, but a screen reader may repeat some content.
- **Native date and time pickers** depend on the browser's own accessibility.
