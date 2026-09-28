import { describe, expect, it } from "vitest";
import { bearerToken } from "../../../src/http/middleware/auth";
import {
  issuePath,
  PROBLEMS,
  problem,
  problemFor,
  validationProblem,
} from "../../../src/http/problem";

describe("problemFor", () => {
  it("maps NOT_FOUND to a 404", () => {
    expect(problemFor({ code: "NOT_FOUND", message: "reminder not found" })).toEqual({
      type: "/problems/not-found",
      title: "Not found",
      status: 404,
      detail: "reminder not found",
    });
  });

  it("maps INVALID to a 400 naming the field", () => {
    expect(
      problemFor({ code: "INVALID", message: "dtstart falls in a gap", field: "dtstart" }),
    ).toMatchObject({
      type: "/problems/validation-failed",
      status: 400,
      errors: [{ path: "dtstart", message: "dtstart falls in a gap" }],
    });
    expect(problemFor({ code: "INVALID", message: "bad" }).errors).toEqual([
      { path: "", message: "bad" },
    ]);
  });

  it("maps CONFLICT to a 409 idempotency conflict", () => {
    expect(problemFor({ code: "CONFLICT", message: "reused" })).toMatchObject({
      type: "/problems/idempotency-conflict",
      status: 409,
    });
  });
});

describe("problems", () => {
  it("have the frozen v0 types and statuses", () => {
    expect(
      Object.entries(PROBLEMS).map(([kind, p]) => [problem(kind as never).type, p.status]),
    ).toEqual([
      ["/problems/validation-failed", 400],
      ["/problems/unauthorized", 401],
      ["/problems/forbidden", 403],
      ["/problems/not-found", 404],
      ["/problems/idempotency-conflict", 409],
      ["/problems/internal", 500],
    ]);
  });

  it("leave out detail and errors when there are none", () => {
    expect(Object.keys(problem("internal"))).toEqual(["type", "title", "status"]);
    expect(validationProblem([{ path: "a", message: "b" }]).errors).toEqual([
      { path: "a", message: "b" },
    ]);
  });
});

describe("issuePath", () => {
  it("names body fields by their path and other inputs by location", () => {
    expect(issuePath("json", ["cap", "maxAttempts"])).toBe("cap.maxAttempts");
    expect(issuePath("json", [])).toBe("");
    expect(issuePath("query", ["limit"])).toBe("query.limit");
    expect(issuePath("header", ["idempotency-key"])).toBe("header.idempotency-key");
    expect(issuePath("param", [])).toBe("param");
  });
});

describe("bearerToken", () => {
  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["Bearer   abc  ", "abc"],
    ["Basic abc", null],
    ["Bearer", null],
    ["Bearer a b", null],
    [undefined, null],
  ])("%s → %s", (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });
});
