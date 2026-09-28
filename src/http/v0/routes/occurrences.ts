import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../env";
import { requireUser } from "../../middleware/auth";
import { idempotencyRequest } from "../../middleware/idempotency";
import { fail } from "../../problem";
import { toAck, toEvent, toOccurrence, toPage } from "../mappers";
import { Ack, EventPage, IdempotencyHeaders, IdParam, OccurrencePage, PageQuery } from "../schemas";
import { json, nudger, pageRequest, problems, USER_AUTH } from "./common";

const TAGS = ["Occurrences"];

const list = createRoute({
  method: "get",
  path: "/reminders/{id}/occurrences",
  tags: TAGS,
  summary: "List a reminder's occurrences, newest first",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { params: IdParam, query: PageQuery },
  responses: {
    200: { description: "A page of occurrences", ...json(OccurrencePage) },
    ...problems(400, 401, 404),
  },
});

const events = createRoute({
  method: "get",
  path: "/occurrences/{id}/events",
  tags: TAGS,
  summary: "List an occurrence's audit events, oldest first",
  description: "Clients must ignore event types they don't know.",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { params: IdParam, query: PageQuery },
  responses: {
    200: { description: "A page of events", ...json(EventPage) },
    ...problems(400, 401, 404),
  },
});

const ack = createRoute({
  method: "post",
  path: "/occurrences/{id}/ack",
  tags: TAGS,
  summary: "Acknowledge an occurrence",
  description:
    "Stops its nags. Acknowledging an occurrence that's already closed changes nothing " +
    "and answers `already_closed`.",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  request: { params: IdParam, headers: IdempotencyHeaders },
  responses: {
    200: { description: "The outcome and the occurrence", ...json(Ack) },
    ...problems(400, 401, 404, 409),
  },
});

export function registerOccurrences(app: OpenAPIHono<AppEnv>): void {
  app.openapi(list, async (c) => {
    const { id } = c.req.valid("param");
    const result = await nudger(c).listOccurrences(id, pageRequest(c.req.valid("query")));
    if (!result.ok) fail(result.error);
    return c.json(toPage(result.value, toOccurrence), 200);
  });

  app.openapi(events, async (c) => {
    const { id } = c.req.valid("param");
    const result = await nudger(c).listEvents(id, pageRequest(c.req.valid("query")));
    if (!result.ok) fail(result.error);
    return c.json(toPage(result.value, toEvent), 200);
  });

  app.openapi(ack, async (c) => {
    const { id } = c.req.valid("param");
    const idempotency = await idempotencyRequest(c, c.req.valid("header")["idempotency-key"], null);
    const result = await nudger(c).acknowledge(id, idempotency);
    if (!result.ok) fail(result.error);
    return c.json(toAck(result.value), 200);
  });
}
