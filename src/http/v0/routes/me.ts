import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { D1AuthStore } from "../../../adapters/d1/AuthStore";
import type { AppEnv } from "../../env";
import { requireUser } from "../../middleware/auth";
import { requireJson } from "../../middleware/json";
import { fail } from "../../problem";
import { fromMePatch, toMe } from "../mappers";
import { Me, MePatch } from "../schemas";
import { json, nudger, problems, USER_AUTH } from "./common";

const TAGS = ["Me"];

const get = createRoute({
  method: "get",
  path: "/me",
  tags: TAGS,
  summary: "Get your profile and settings",
  security: USER_AUTH,
  middleware: [requireUser] as const,
  responses: {
    200: { description: "You", ...json(Me) },
    ...problems(401),
  },
});

const update = createRoute({
  method: "patch",
  path: "/me",
  tags: TAGS,
  summary: "Change your time zone or quiet hours",
  description: "Takes effect from the next due nag; nags already scheduled don't move.",
  security: USER_AUTH,
  middleware: [requireUser, requireJson] as const,
  request: { body: { required: true, ...json(MePatch) } },
  responses: {
    200: { description: "You, changed", ...json(Me) },
    ...problems(400, 401),
  },
});

export function registerMe(app: OpenAPIHono<AppEnv>): void {
  app.openapi(get, async (c) => {
    return c.json(toMe(c.var.user, await nudger(c).getSettings()), 200);
  });

  app.openapi(update, async (c) => {
    const patch = c.req.valid("json");
    const user = c.var.user;
    // The Durable Object's copy is what scheduling uses, so it changes first. D1 follows;
    // if that write fails, retrying the same PATCH brings the two back in line.
    const result = await nudger(c).updateSettings(fromMePatch(patch));
    if (!result.ok) fail(result.error);
    if (patch.timezone !== undefined && patch.timezone !== user.timezone) {
      await new D1AuthStore(c.env.DB).updateUserTimezone(user.id, patch.timezone);
    }
    return c.json(toMe(user, result.value), 200);
  });
}
