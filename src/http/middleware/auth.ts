import { createMiddleware } from "hono/factory";
import { D1AuthStore } from "../../adapters/d1/AuthStore";
import { authenticate, verifyAdminKey } from "../../app/auth";
import type { AppEnv } from "../env";
import { ProblemError, problem } from "../problem";

const CHALLENGE = { "WWW-Authenticate": 'Bearer realm="nudge-a-tron-5000"' };

/** The token in `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer +(\S+) *$/i.exec(header ?? "");
  return match === null ? null : (match[1] as string);
}

const unauthorized = () =>
  new ProblemError(problem("unauthorized", "Send a valid API key as a Bearer token"), CHALLENGE);

/**
 * Requires a valid, unrevoked user API key and puts its user on the context. Every
 * failure gets the same 401, so a caller can't tell a revoked key from an unknown one.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  const user = token === null ? null : await authenticate(new D1AuthStore(c.env.DB), token);
  if (user === null) throw unauthorized();
  c.set("user", user);
  await next();
});

/**
 * Requires the `ADMIN_API_KEY` secret. A valid user key gets 403 (it's a real key, just
 * not allowed here); anything else gets 401.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (token !== null && (await verifyAdminKey(token, c.env.ADMIN_API_KEY))) {
    await next();
    return;
  }
  if (token !== null && (await authenticate(new D1AuthStore(c.env.DB), token)) !== null) {
    throw new ProblemError(problem("forbidden", "Admin routes need the admin key"));
  }
  throw unauthorized();
});
