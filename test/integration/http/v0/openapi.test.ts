import { describe, expect, it } from "vitest";
import snapshot from "../../../../openapi/v0.json";
import { call, expectJson } from "./api";

describe("GET /v0/openapi.json", () => {
  it("serves the committed v0 document, without auth", async () => {
    const doc = await expectJson(await call("GET", "/v0/openapi.json"), 200);
    expect(doc).toEqual(snapshot);
    expect(doc).toMatchObject({ openapi: "3.1.0", servers: [{ url: "/v0" }] });
  });
});
