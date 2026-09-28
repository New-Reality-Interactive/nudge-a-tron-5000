import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { D1AuthStore } from "../../../adapters/d1/AuthStore";
import { cryptoRandom } from "../../../adapters/system/cryptoRandom";
import { SystemClock } from "../../../adapters/system/SystemClock";
import { UuidV7IdGenerator } from "../../../adapters/system/UuidV7IdGenerator";
import { issueApiKey, revokeApiKey } from "../../../app/auth";
import type { UserRecord } from "../../../app/ports";
import type { AppEnv } from "../../env";
import { requireAdmin } from "../../middleware/auth";
import { requireJson } from "../../middleware/json";
import { fail } from "../../problem";
import { toIssuedKey, toUser } from "../mappers";
import { IssuedKey, User, UserCreate, UserIdParam, UserKeyParams } from "../schemas";
import { ADMIN_AUTH, json, problems } from "./common";

const TAGS = ["Admin"];

const createUser = createRoute({
  method: "post",
  path: "/admin/users",
  tags: TAGS,
  summary: "Create a user",
  description: "Doesn't take an Idempotency-Key: a retry after a timeout can create a second user.",
  security: ADMIN_AUTH,
  middleware: [requireAdmin, requireJson] as const,
  request: { body: { required: true, ...json(UserCreate) } },
  responses: {
    201: { description: "The new user", ...json(User) },
    ...problems(400, 401, 403),
  },
});

const createKey = createRoute({
  method: "post",
  path: "/admin/users/{userId}/keys",
  tags: TAGS,
  summary: "Issue an API key",
  description:
    "The full key is in this response only; just a hash of it is stored. Doesn't take an " +
    "Idempotency-Key, since replaying would need the key stored: revoke any extra key instead.",
  security: ADMIN_AUTH,
  middleware: [requireAdmin] as const,
  request: { params: UserIdParam },
  responses: {
    201: { description: "The new key", ...json(IssuedKey) },
    ...problems(400, 401, 403, 404),
  },
});

const revokeKey = createRoute({
  method: "delete",
  path: "/admin/users/{userId}/keys/{keyId}",
  tags: TAGS,
  summary: "Revoke an API key",
  description: "Revoking a key that's already revoked succeeds.",
  security: ADMIN_AUTH,
  middleware: [requireAdmin] as const,
  request: { params: UserKeyParams },
  responses: {
    204: { description: "Revoked" },
    ...problems(400, 401, 403, 404),
  },
});

export function registerAdmin(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createUser, async (c) => {
    const { name, timezone } = c.req.valid("json");
    const clock = new SystemClock();
    const user: UserRecord = {
      id: new UuidV7IdGenerator(clock).next(),
      name,
      timezone,
      createdAt: clock.now(),
    };
    // Seed the Durable Object first: an object left behind by a failed D1 insert is
    // harmless, because no key can ever reach it.
    const seeded = await c.env.USER_NUDGER.getByName(user.id).updateSettings({ timezone });
    if (!seeded.ok) fail(seeded.error);
    await new D1AuthStore(c.env.DB).insertUser(user);
    return c.json(toUser(user), 201);
  });

  app.openapi(createKey, async (c) => {
    const { userId } = c.req.valid("param");
    const deps = { clock: new SystemClock(), random: cryptoRandom };
    const result = await issueApiKey(new D1AuthStore(c.env.DB), deps, userId);
    if (!result.ok) fail(result.error);
    return c.json(toIssuedKey(result.value), 201);
  });

  app.openapi(revokeKey, async (c) => {
    const { userId, keyId } = c.req.valid("param");
    const store = new D1AuthStore(c.env.DB);
    const result = await revokeApiKey(store, new SystemClock(), userId, keyId);
    if (!result.ok) fail(result.error);
    return c.body(null, 204);
  });
}
