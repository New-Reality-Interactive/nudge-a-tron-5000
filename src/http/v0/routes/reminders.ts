import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { requireUser } from "../../middleware/auth";
import { idempotencyRequest } from "../../middleware/idempotency";
import { requireJson } from "../../middleware/json";
import { fail } from "../../problem";
import { fromReminderCreate, fromReminderPatch, toPage, toReminder } from "../mappers";
import {
  IdempotencyHeaders,
  IdParam,
  PageQuery,
  Reminder,
  ReminderCreate,
  ReminderPage,
  ReminderPatch,
} from "../schemas";
import { json, nudger, pageRequest, problems, USER_AUTH } from "./common";

const TAGS = ["Reminders"];

const create = createRoute({
  method: "post",
  path: "/reminders",
  tags: TAGS,
  summary: "Create a reminder",
  security: USER_AUTH,
  middleware: [requireUser, requireJson] as const,
  request: {
    headers: IdempotencyHeaders,
    body: { required: true, ...json(ReminderCreate) },
  },
  responses: {
    201: { description: "The new reminder", ...json(Reminder) },
    ...problems(400, 401, 409),
  },
});

const list = createRoute({
  method: "get",
  path: "/reminders",
  tags: TAGS,
  summary: "List reminders, oldest first",
  description: "Deleted reminders aren't listed.",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { query: PageQuery },
  responses: {
    200: { description: "A page of reminders", ...json(ReminderPage) },
    ...problems(400, 401),
  },
});

const get = createRoute({
  method: "get",
  path: "/reminders/{id}",
  tags: TAGS,
  summary: "Get a reminder",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { params: IdParam },
  responses: {
    200: { description: "The reminder", ...json(Reminder) },
    ...problems(400, 401, 404),
  },
});

const update = createRoute({
  method: "patch",
  path: "/reminders/{id}",
  tags: TAGS,
  summary: "Change a reminder",
  description:
    "A schedule change (dtstart, timezone or rrule) moves the next occurrence to the new " +
    "schedule. An open occurrence keeps nagging; strength and cap apply from its next nag.",
  security: USER_AUTH,
  middleware: [requireUser, requireJson] as const,
  request: {
    params: IdParam,
    body: { required: true, ...json(ReminderPatch) },
  },
  responses: {
    200: { description: "The changed reminder", ...json(Reminder) },
    ...problems(400, 401, 404),
  },
});

const remove = createRoute({
  method: "delete",
  path: "/reminders/{id}",
  tags: TAGS,
  summary: "Delete a reminder",
  description:
    "Stops the reminder: it gets no more occurrences, and its open occurrence is cancelled. " +
    "Its occurrences and their events stay readable by id.",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { params: IdParam },
  responses: {
    204: { description: "Deleted" },
    ...problems(400, 401, 404),
  },
});

export function registerReminders(app: OpenAPIHono<AppEnv>): void {
  app.openapi(create, async (c) => {
    const body = c.req.valid("json");
    const idempotency = await idempotencyRequest(c, c.req.valid("header")["idempotency-key"], body);
    const result = await nudger(c).createReminder(fromReminderCreate(body), idempotency);
    if (!result.ok) fail(result.error);
    return c.json(toReminder(result.value), 201);
  });

  app.openapi(list, async (c) => {
    const page = await nudger(c).listReminders(pageRequest(c.req.valid("query")));
    return c.json(toPage(page, toReminder), 200);
  });

  app.openapi(get, async (c) => {
    const result = await nudger(c).getReminder(c.req.valid("param").id);
    if (!result.ok) fail(result.error);
    return c.json(toReminder(result.value), 200);
  });

  app.openapi(update, async (c) => {
    const { id } = c.req.valid("param");
    const result = await nudger(c).updateReminder(id, fromReminderPatch(c.req.valid("json")));
    if (!result.ok) fail(result.error);
    return c.json(toReminder(result.value), 200);
  });

  app.openapi(remove, async (c) => {
    const result = await nudger(c).deleteReminder(c.req.valid("param").id);
    if (!result.ok) fail(result.error);
    return c.body(null, 204);
  });
}
