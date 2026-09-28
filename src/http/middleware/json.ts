import { createMiddleware } from "hono/factory";
import { ProblemError, validationProblem } from "../problem";

const JSON_TYPE = /^application\/json\s*(;|$)/i;

/**
 * Requires a JSON request body. Without this, a body sent with another Content-Type is
 * skipped by validation and treated as `{}`, which would turn a PATCH into a silent no-op.
 */
export const requireJson = createMiddleware(async (c, next) => {
  if (!JSON_TYPE.test(c.req.header("Content-Type") ?? "")) {
    throw new ProblemError(
      validationProblem([
        { path: "header.content-type", message: "the body must be sent as application/json" },
      ]),
    );
  }
  await next();
});
