import { describe, expect, it } from "vitest";

// Placeholder until the domain core lands in Milestone 2: proves the unit
// project runs in plain Node (fast, no workerd) as intended.
describe("unit test project", () => {
  it("runs in Node, not workerd", () => {
    expect(typeof process.versions.node).toBe("string");
    expect(navigator.userAgent).not.toBe("Cloudflare-Workers");
  });
});
