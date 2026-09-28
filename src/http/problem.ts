import type { Context } from "hono";
import type { AppError } from "../app/result";

// RFC 9457 problem details. The `type` values are part of the API contract (ADR 0007,
// ADR 0008): new ones may be added for new situations, these never change.

export const PROBLEMS = {
  "validation-failed": { status: 400, title: "The request isn't valid" },
  unauthorized: { status: 401, title: "Authentication is required" },
  forbidden: { status: 403, title: "This key can't use this route" },
  "not-found": { status: 404, title: "Not found" },
  "idempotency-conflict": {
    status: 409,
    title: "This Idempotency-Key was used with a different request",
  },
  internal: { status: 500, title: "Something went wrong on our side" },
} as const;

export type ProblemKind = keyof typeof PROBLEMS;
export type ProblemStatus = (typeof PROBLEMS)[ProblemKind]["status"];

/** One invalid input: where it is (e.g. `cap.maxAttempts`, `query.limit`) and why. */
export interface FieldError {
  path: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: ProblemStatus;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function problem(kind: ProblemKind, detail?: string, errors?: FieldError[]): Problem {
  const { status, title } = PROBLEMS[kind];
  return {
    type: `/problems/${kind}`,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(errors !== undefined ? { errors } : {}),
  };
}

/** The problem for an error a use case returned. */
export function problemFor(error: AppError): Problem {
  switch (error.code) {
    case "NOT_FOUND":
      return problem("not-found", error.message);
    case "INVALID":
      return problem("validation-failed", error.message, [
        { path: error.field ?? "", message: error.message },
      ]);
    case "CONFLICT":
      return problem("idempotency-conflict", error.message);
  }
}

/** A validation problem listing every failed input. */
export function validationProblem(errors: FieldError[]): Problem {
  return problem("validation-failed", "One or more inputs are invalid", errors);
}

/**
 * The `path` for a zod issue: the input's location (`query`, `header`, `param`) and its
 * path within it, or just its path within a JSON body.
 */
export function issuePath(target: string, path: readonly PropertyKey[]): string {
  const inner = path.map(String).join(".");
  if (target === "json") return inner;
  return inner === "" ? target : `${target}.${inner}`;
}

/** Thrown by handlers and middleware; `onError` turns it into a problem response. */
export class ProblemError extends Error {
  readonly problem: Problem;
  readonly headers: Record<string, string>;

  constructor(problem: Problem, headers: Record<string, string> = {}) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
    this.problem = problem;
    this.headers = headers;
  }
}

/** Throws the problem for an error a use case returned. */
export function fail(error: AppError): never {
  throw new ProblemError(problemFor(error));
}

export function problemResponse(
  c: Context,
  p: Problem,
  headers: Record<string, string> = {},
): Response {
  const body: Problem = { ...p, instance: c.req.path };
  return new Response(JSON.stringify(body), {
    status: p.status,
    headers: { ...headers, "Content-Type": PROBLEM_CONTENT_TYPE },
  });
}
