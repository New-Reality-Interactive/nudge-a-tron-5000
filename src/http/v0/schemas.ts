import { z } from "@hono/zod-openapi";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../app/pagination";
import { checkRrule, RRULE_LIMITS } from "../../app/scheduleLimits";
import { isTimeZone } from "../../app/shared";

// The v0 wire contract (ADR 0007). Within v0 these may only grow: new optional request
// fields, new response fields, new enum values. Limits may be loosened, never tightened.
// Request bodies are strict, so an unknown field is an error rather than ignored.

export const LIMITS = {
  title: 200,
  body: 2000,
  name: 100,
  maxDurationMinutes: 7 * 24 * 60,
  maxAttempts: 100,
} as const;

// ---- Shared pieces --------------------------------------------------------------------

const Id = z.string().min(1).max(64);
const Instant = z.string().openapi({ format: "date-time", example: "2030-06-10T13:00:00Z" });

const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, "must be an IANA time zone name, e.g. America/New_York")
  .openapi({
    description: "An IANA time zone name, exactly as listed (not an offset such as +05:00).",
    example: "America/New_York",
  });

const LocalDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    "must be a local date-time, YYYY-MM-DDTHH:MM[:SS]",
  )
  .openapi({
    description: "Local wall-clock time in `timezone`. It must exist there (not in a DST gap).",
    example: "2030-06-10T09:00",
  });

const Rrule = z
  .string()
  .max(RRULE_LIMITS.maxLength)
  .superRefine((rrule, ctx) => {
    for (const message of checkRrule(rrule)) ctx.addIssue({ code: "custom", message });
  })
  .openapi({
    description:
      "RFC 5545 RRULE without the `RRULE:` prefix. FREQ may not be SECONDLY; BYSECOND takes " +
      `one value; COUNT and INTERVAL are 1–${RRULE_LIMITS.maxCount}; at most ` +
      `${RRULE_LIMITS.maxLength} characters. Occurrences are always at least a minute apart.`,
    example: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  });

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM")
  .openapi({ example: "22:00" });

export const Strength = z.enum(["gentle", "firm", "relentless"]).openapi("Strength", {
  description: "How insistently a reminder nags (see ADR 0005).",
});

export const Cap = z
  .strictObject({
    maxDurationMinutes: z.number().int().min(1).max(LIMITS.maxDurationMinutes).optional(),
    maxAttempts: z.number().int().min(1).max(LIMITS.maxAttempts).optional(),
  })
  .openapi("Cap", {
    description:
      "When an unanswered occurrence gives up. Unset fields use the system default (24 h, 20 attempts).",
  });

export const QuietHours = z.strictObject({ start: HHMM, end: HHMM }).openapi("QuietHours", {
  description:
    "A daily window in the user's time zone, [start, end). start > end crosses midnight.",
});

// ---- Problems -------------------------------------------------------------------------

export const Problem = z
  .object({
    type: z.string().openapi({ example: "/problems/validation-failed" }),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: "For validation-failed: each invalid input." }),
  })
  .openapi("Problem", { description: "RFC 9457 problem details." });

// ---- Parameters -----------------------------------------------------------------------

export const IdParam = z.object({ id: Id.openapi({ param: { name: "id", in: "path" } }) });

export const UserIdParam = z.object({
  userId: Id.openapi({ param: { name: "userId", in: "path" } }),
});

export const UserKeyParams = z.object({
  userId: Id.openapi({ param: { name: "userId", in: "path" } }),
  keyId: Id.openapi({ param: { name: "keyId", in: "path" } }),
});

export const PageQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .openapi({ param: { name: "limit", in: "query" }, example: DEFAULT_PAGE_SIZE }),
  cursor: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description: "`nextCursor` from the previous page.",
    }),
});

export const IdempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\x20-\x7e]+$/, "must be printable ASCII")
    .optional()
    .openapi({
      param: { name: "idempotency-key", in: "header" },
      description:
        "Retrying with the same key and body returns the first response for 24 hours; " +
        "the same key with a different request gets 409.",
    }),
});

// ---- Reminders ------------------------------------------------------------------------

const Title = z
  .string()
  .min(1)
  .max(LIMITS.title)
  .regex(/\S/, "must not be blank")
  .openapi({ example: "Take the bins out" });
const Body = z.string().max(LIMITS.body).nullable();

export const ReminderCreate = z
  .strictObject({
    title: Title,
    body: Body.optional(),
    dtstart: LocalDateTime,
    timezone: TimeZone,
    rrule: Rrule.nullable().optional(),
    strength: Strength,
    cap: Cap.optional(),
  })
  .openapi("ReminderCreate");

export const ReminderPatch = z
  .strictObject({
    title: Title.optional(),
    body: Body.optional(),
    dtstart: LocalDateTime.optional(),
    timezone: TimeZone.optional(),
    rrule: Rrule.nullable().optional(),
    strength: Strength.optional(),
    cap: Cap.optional(),
  })
  .openapi("ReminderPatch", {
    description:
      "Only the fields sent change. `body: null` and `rrule: null` clear them; `cap` is replaced as a whole.",
  });

export const Reminder = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    dtstart: z.string().openapi({ example: "2030-06-10T09:00:00" }),
    timezone: z.string(),
    rrule: z.string().nullable(),
    strength: Strength,
    cap: Cap,
    status: z.enum(["ACTIVE", "COMPLETED"]),
    nextOccurrenceAt: Instant.nullable(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .openapi("Reminder");

// ---- Occurrences and events -----------------------------------------------------------

export const Occurrence = z
  .object({
    id: z.string(),
    reminderId: z.string(),
    scheduledFor: Instant,
    level: z.number().int(),
    attempts: z.number().int(),
    state: z.enum(["PENDING", "NAGGING", "ACKED", "MISSED", "CANCELLED"]),
    nextNagAt: Instant.nullable(),
    closedAt: Instant.nullable(),
    closeReason: z.enum(["cap", "superseded"]).nullable(),
  })
  .openapi("Occurrence");

const eventOf = <T extends string, D extends z.ZodType>(type: T, data: D, description: string) =>
  z
    .object({
      id: z.string(),
      occurrenceId: z.string(),
      type: z.literal(type),
      at: Instant,
      data,
    })
    .openapi(`Event${type}`, { description });

const Empty = z.object({});

export const Event = z
  .discriminatedUnion("type", [
    eventOf("SCHEDULED", z.object({ level: z.number().int() }), "The occurrence was created."),
    eventOf(
      "NAG_SENT",
      z.object({
        attempt: z.number().int(),
        level: z.number().int(),
        priority: z.number().int(),
      }),
      "A nag was queued for delivery.",
    ),
    eventOf(
      "SEND_FAILED",
      z.object({
        attempt: z.number().int(),
        tries: z.number().int(),
        nextTryAt: Instant.nullable(),
      }),
      "Delivering a nag failed. `nextTryAt` is null once delivery gives up.",
    ),
    eventOf(
      "DEFERRED_QUIET",
      z.object({ until: Instant }),
      "A nag was deferred to the end of quiet hours.",
    ),
    eventOf("ACKED", Empty, "The occurrence was acknowledged."),
    eventOf("MISSED", z.object({ reason: z.enum(["cap"]) }), "The occurrence gave up unanswered."),
    eventOf(
      "SUPERSEDED",
      z.object({ by: z.string() }),
      "The next occurrence replaced this unanswered one.",
    ),
    eventOf("CANCELLED", Empty, "The reminder was deleted."),
  ])
  .openapi("Event");

export const Ack = z
  .object({
    outcome: z.enum(["acked", "already_closed"]),
    occurrence: Occurrence,
  })
  .openapi("Ack");

// ---- Pages ----------------------------------------------------------------------------

const pageOf = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z
        .string()
        .nullable()
        .openapi({ description: "Pass as `cursor` for the next page; null on the last page." }),
    })
    .openapi(name);

export const ReminderPage = pageOf(Reminder, "ReminderPage");
export const OccurrencePage = pageOf(Occurrence, "OccurrencePage");
export const EventPage = pageOf(Event, "EventPage");

// ---- Me -------------------------------------------------------------------------------

export const Me = z
  .object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
    quietHours: QuietHours.nullable(),
  })
  .openapi("Me");

export const MePatch = z
  .strictObject({
    timezone: TimeZone.optional(),
    quietHours: QuietHours.nullable().optional(),
  })
  .openapi("MePatch", { description: "`quietHours: null` turns quiet hours off." });

// ---- Admin ----------------------------------------------------------------------------

export const UserCreate = z
  .strictObject({
    name: z.string().min(1).max(LIMITS.name).regex(/\S/, "must not be blank"),
    timezone: TimeZone,
  })
  .openapi("UserCreate");

export const User = z
  .object({ id: z.string(), name: z.string(), timezone: z.string(), createdAt: Instant })
  .openapi("User");

export const IssuedKey = z
  .object({
    keyId: z.string(),
    key: z.string().openapi({
      description: "The full API key. It's shown only in this response and can't be retrieved.",
      example: "nt5k_abcdefghijklmnop_…",
    }),
    userId: z.string(),
    createdAt: Instant,
  })
  .openapi("IssuedKey");
