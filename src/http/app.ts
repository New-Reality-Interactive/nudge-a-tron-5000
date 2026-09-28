import { Hono } from "hono";
import type { AppEnv } from "./env";
import { notFound, onError } from "./middleware/errors";
import { createV0 } from "./v0/openapi";

/**
 * The root app. Each API major version is a sibling under its own prefix (ADR 0007);
 * `/a/{token}` (M5) stays unversioned.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.route("/v0", createV0());
  app.notFound(notFound);
  app.onError(onError);
  return app;
}
