import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodError } from "zod";
import { issuePath, ProblemError, problem, problemResponse, validationProblem } from "../problem";

/** The zod-openapi hook: a failed validation becomes a 400 listing every invalid input. */
export function validationHook(
  result: { success: true } | { success: false; error: ZodError; target: string },
  c: Context,
): Response | undefined {
  if (result.success) return undefined;
  return problemResponse(
    c,
    validationProblem(
      result.error.issues.map((issue) => ({
        path: issuePath(result.target, issue.path),
        message: issue.message,
      })),
    ),
  );
}

export const notFound: NotFoundHandler = (c) =>
  problemResponse(c, problem("not-found", `No route for ${c.req.method} ${c.req.path}`));

/**
 * Every error becomes a problem response. Expected ones (`ProblemError`, Hono's own 4xx
 * such as malformed JSON) keep their status. Anything else is logged and returned as a
 * bare 500: no stack, no message. The log line has no headers or body, so no keys.
 */
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof ProblemError) return problemResponse(c, err.problem, err.headers);
  if (err instanceof HTTPException && err.status === 400) {
    return problemResponse(
      c,
      validationProblem([{ path: "body", message: "the body isn't valid JSON" }]),
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      message: "unhandled error",
      requestId: c.req.header("cf-ray") ?? null,
      method: c.req.method,
      route: c.req.routePath,
      error: err.name,
      detail: err.message,
    }),
  );
  return problemResponse(c, problem("internal"));
};
