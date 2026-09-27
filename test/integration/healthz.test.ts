import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await exports.default.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const res = await exports.default.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
  });
});
