import type { Context } from "hono";
import { fingerprint, type IdempotencyRequest } from "../../app/idempotency";

/**
 * The idempotency request for a mutating POST, or undefined when it carries no
 * `Idempotency-Key`. The fingerprint covers the method, the path (so the resource) and
 * the validated body, whatever the order of its keys (ADR 0008).
 */
export async function idempotencyRequest(
  c: Context,
  key: string | undefined,
  body: unknown,
): Promise<IdempotencyRequest | undefined> {
  if (key === undefined) return undefined;
  return { key, fingerprint: await fingerprint(c.req.method, c.req.path, body) };
}
