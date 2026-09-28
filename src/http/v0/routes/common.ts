import type { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { PageRequest } from "../../../app/pagination";
import type { AppEnv } from "../../env";
import {
  PROBLEM_CONTENT_TYPE,
  type PROBLEMS,
  ProblemError,
  validationProblem,
} from "../../problem";
import { decodeCursor } from "../mappers";
import { Problem } from "../schemas";

/** OpenAPI security requirements. */
export const USER_AUTH = [{ apiKey: [] }];
export const ADMIN_AUTH = [{ adminKey: [] }];

/** A JSON response or request body. */
export const json = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});

type Status = (typeof PROBLEMS)[keyof typeof PROBLEMS]["status"];

const DESCRIPTIONS: Record<Status, string> = {
  400: "Invalid input (`/problems/validation-failed`), with each invalid field in `errors`",
  401: "Missing or invalid key (`/problems/unauthorized`)",
  403: "A user key on an admin route (`/problems/forbidden`)",
  404: "Not found (`/problems/not-found`)",
  409: "Idempotency-Key reused with a different request (`/problems/idempotency-conflict`)",
  500: "Unexpected error (`/problems/internal`)",
};

/** The problem responses a route can return. 500 is always included. */
export function problems(...statuses: Exclude<Status, 500>[]) {
  return Object.fromEntries(
    [...statuses, 500 as const].map((status) => [
      status,
      {
        description: DESCRIPTIONS[status],
        content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
      },
    ]),
  );
}

/** The signed-in user's Durable Object (ADR 0001). */
export const nudger = (c: Context<AppEnv>) => c.env.USER_NUDGER.getByName(c.var.user.id);

/** The page to fetch for `?limit&cursor`. A cursor that isn't ours is a 400. */
export function pageRequest(query: { limit: number; cursor?: string | undefined }): PageRequest {
  if (query.cursor === undefined) return { limit: query.limit, after: null };
  const after = decodeCursor(query.cursor);
  if (after === null) {
    throw new ProblemError(
      validationProblem([{ path: "query.cursor", message: "isn't a cursor from this API" }]),
    );
  }
  return { limit: query.limit, after };
}
