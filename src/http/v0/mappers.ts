import type { z } from "@hono/zod-openapi";
import type { IssuedKey as IssuedKeyDto } from "../../app/auth";
import type {
  AckDto,
  CreateReminderInput,
  EventDto,
  OccurrenceDto,
  ReminderDto,
  SettingsDto,
  SettingsPatch,
  UpdateReminderInput,
} from "../../app/dto";
import type { Page } from "../../app/pagination";
import type { UserRecord } from "../../app/ports";
import type * as S from "./schemas";

// App DTOs → the v0 wire format. The DTOs are internal and may change freely; these
// functions are where the compiler shows which v0 fields a change touches.

type Wire<T extends z.ZodType> = z.infer<T>;

/** Cursors are opaque to clients: base64url of the last item's id. */
export function encodeCursor(after: string | null): string | null {
  if (after === null) return null;
  return btoa(after).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The id a cursor stands for, or null when it isn't one of ours. */
export function decodeCursor(cursor: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const id = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    return /^[\x21-\x7e]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function toPage<T, W>(
  page: Page<T>,
  map: (item: T) => W,
): { items: W[]; nextCursor: string | null } {
  return { items: page.items.map(map), nextCursor: encodeCursor(page.nextAfter) };
}

/** Keeps only the fields that are present, since the app types treat absent as unchanged. */
function present<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

export function fromReminderCreate(w: Wire<typeof S.ReminderCreate>): CreateReminderInput {
  const { title, dtstart, timezone, strength, ...optional } = w;
  const rest = present(optional);
  return {
    title,
    dtstart,
    timezone,
    strength,
    ...(rest.body !== undefined ? { body: rest.body } : {}),
    ...(rest.rrule !== undefined ? { rrule: rest.rrule } : {}),
    ...(rest.cap !== undefined ? { cap: present(rest.cap) } : {}),
  };
}

export function fromReminderPatch(w: Wire<typeof S.ReminderPatch>): UpdateReminderInput {
  const { cap, ...rest } = present(w);
  return { ...rest, ...(cap !== undefined ? { cap: present(cap) } : {}) };
}

export function fromMePatch(w: Wire<typeof S.MePatch>): SettingsPatch {
  return present(w);
}

export function toReminder(r: ReminderDto): Wire<typeof S.Reminder> {
  // Deleted reminders are hidden from every query, so they never reach the wire.
  if (r.status === "DELETED") throw new Error(`deleted reminder ${r.id} reached the API`);
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    dtstart: r.dtstart,
    timezone: r.timezone,
    rrule: r.rrule,
    strength: r.strength,
    cap: {
      ...(r.cap.maxDurationMinutes !== undefined
        ? { maxDurationMinutes: r.cap.maxDurationMinutes }
        : {}),
      ...(r.cap.maxAttempts !== undefined ? { maxAttempts: r.cap.maxAttempts } : {}),
    },
    status: r.status,
    nextOccurrenceAt: r.nextOccurrenceAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toOccurrence(o: OccurrenceDto): Wire<typeof S.Occurrence> {
  return {
    id: o.id,
    reminderId: o.reminderId,
    scheduledFor: o.scheduledFor,
    level: o.level,
    attempts: o.attempts,
    state: o.state,
    nextNagAt: o.nextNagAt,
    closedAt: o.closedAt,
    closeReason: o.closeReason,
  };
}

const num = (e: EventDto, field: string): number => {
  const v = e.data[field];
  if (typeof v !== "number") throw new Error(`event ${e.id}: ${field} isn't a number`);
  return v;
};

const str = (e: EventDto, field: string): string => {
  const v = e.data[field];
  if (typeof v !== "string") throw new Error(`event ${e.id}: ${field} isn't a string`);
  return v;
};

const strOrNull = (e: EventDto, field: string): string | null =>
  e.data[field] === null ? null : str(e, field);

/**
 * Each event type's stored data, mapped field by field to its own v0 schema, so the
 * stored shape never becomes the public one by accident.
 */
export function toEvent(e: EventDto): Wire<typeof S.Event> {
  const base = { id: e.id, occurrenceId: e.occurrenceId, at: e.at };
  switch (e.type) {
    case "SCHEDULED":
      return { ...base, type: e.type, data: { level: num(e, "level") } };
    case "NAG_SENT":
      return {
        ...base,
        type: e.type,
        data: { attempt: num(e, "attempt"), level: num(e, "level"), priority: num(e, "priority") },
      };
    case "SEND_FAILED":
      return {
        ...base,
        type: e.type,
        data: {
          attempt: num(e, "attempt"),
          tries: num(e, "tries"),
          nextTryAt: strOrNull(e, "nextTryAt"),
        },
      };
    case "DEFERRED_QUIET":
      return { ...base, type: e.type, data: { until: str(e, "until") } };
    case "ACKED":
    case "CANCELLED":
      return { ...base, type: e.type, data: {} };
    case "MISSED":
      return { ...base, type: e.type, data: { reason: "cap" } };
    case "SUPERSEDED":
      return { ...base, type: e.type, data: { by: str(e, "by") } };
  }
}

export function toAck(a: AckDto): Wire<typeof S.Ack> {
  return { outcome: a.outcome, occurrence: toOccurrence(a.occurrence) };
}

export function toMe(user: UserRecord, settings: SettingsDto): Wire<typeof S.Me> {
  return {
    id: user.id,
    name: user.name,
    timezone: settings.timezone,
    quietHours:
      settings.quietHours === null
        ? null
        : { start: settings.quietHours.start, end: settings.quietHours.end },
  };
}

export function toUser(user: UserRecord): Wire<typeof S.User> {
  return {
    id: user.id,
    name: user.name,
    timezone: user.timezone,
    createdAt: user.createdAt.toString(),
  };
}

export function toIssuedKey(k: IssuedKeyDto): Wire<typeof S.IssuedKey> {
  return { keyId: k.keyId, key: k.key, userId: k.userId, createdAt: k.createdAt };
}
