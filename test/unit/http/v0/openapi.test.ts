import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { createV0, v0Document } from "../../../../src/http/v0/openapi";

// The committed snapshot is the v0 contract as of the last commit. This test fails when
// the generated document differs; regenerate with `npm run openapi` and review the diff.
// CI also runs oasdiff on pull requests to catch breaking changes (ADR 0007, ADR 0008).

describe("v0 OpenAPI document", () => {
  const document = v0Document();

  it("matches the committed snapshot, openapi/v0.json", async () => {
    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot(
      "../../../../openapi/v0.json",
    );
  });

  it("is a valid OpenAPI 3.1 document", async () => {
    const validator = new Validator();
    const result = await validator.validate(
      JSON.parse(JSON.stringify(document)) as Record<string, unknown>,
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
  });

  it("documents every route the v0 app serves", () => {
    const served = createV0()
      .routes.filter((r) => r.method !== "ALL" && r.path !== "/openapi.json")
      .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`);
    const documented = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item ?? {}).map((method) => `${method} ${path}`),
    );
    expect(new Set(served)).toEqual(new Set(documented));
    expect(documented).toHaveLength(13);
  });

  it("describes every error as problem+json", () => {
    for (const item of Object.values(document.paths ?? {})) {
      for (const op of Object.values(item ?? {}) as { responses: Record<string, unknown> }[]) {
        for (const [status, response] of Object.entries(op.responses)) {
          if (Number(status) < 400) continue;
          expect(Object.keys((response as { content: object }).content)).toEqual([
            "application/problem+json",
          ]);
        }
      }
    }
  });
});
