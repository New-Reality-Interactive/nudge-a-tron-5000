import type { UseCaseDeps } from "./ports";
import { type AppResult, conflict } from "./result";
import { toHex } from "./shared";

/** How long a key's result is kept for replay (ADR 0008). */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** An `Idempotency-Key` and a fingerprint of the request that carried it. */
export interface IdempotencyRequest {
  key: string;
  fingerprint: string;
}

/**
 * Runs `run` at most once per key. The first request stores its result; a later request
 * with the same key and fingerprint gets that result back without running again, and one
 * with a different fingerprint gets CONFLICT. Expired keys are purged first, so a key can
 * be reused once its record has expired.
 *
 * Everything happens in one transaction, and the Durable Object runs one request at a
 * time, so two requests with the same key can't both run. Without a key, `run` just runs.
 */
export function idempotent<T>(
  deps: UseCaseDeps,
  request: IdempotencyRequest | undefined,
  run: () => AppResult<T>,
): AppResult<T> {
  if (request === undefined) return run();
  const { repo, clock } = deps;
  return repo.transaction(() => {
    const now = clock.now();
    repo.purgeIdempotency(now);

    const stored = repo.getIdempotency(request.key);
    if (stored !== null) {
      return stored.fingerprint === request.fingerprint
        ? (JSON.parse(stored.result) as AppResult<T>)
        : conflict("this Idempotency-Key was already used with a different request");
    }

    const result = run();
    repo.saveIdempotency({
      key: request.key,
      fingerprint: request.fingerprint,
      result: JSON.stringify(result),
      createdAt: now,
      expiresAt: now.add({ hours: IDEMPOTENCY_TTL_HOURS }),
    });
    return result;
  });
}

/** JSON with object keys sorted at every level, so key order doesn't change the text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/**
 * Identifies a request for idempotency: SHA-256 over its method, path and canonical body.
 * The same key sent to another route, another resource or with another body differs.
 */
export async function fingerprint(method: string, path: string, body: unknown): Promise<string> {
  const text = `${method.toUpperCase()} ${path}\n${canonicalJson(body ?? null)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}
