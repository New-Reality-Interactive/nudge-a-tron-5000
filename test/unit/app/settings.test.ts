import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "../../../src/app/settings";
import { harness, value } from "./harness";

describe("settings", () => {
  it("defaults to UTC with no quiet hours", () => {
    expect(getSettings(harness().deps)).toEqual({ timezone: "UTC", quietHours: null });
  });

  it("changes only what the patch names", () => {
    const h = harness();
    value(updateSettings(h.deps, { quietHours: { start: "22:00", end: "07:30" } }));
    expect(value(updateSettings(h.deps, { timezone: "Europe/London" }))).toEqual({
      timezone: "Europe/London",
      quietHours: { start: "22:00", end: "07:30" },
    });
    expect(value(updateSettings(h.deps, { quietHours: null }))).toEqual({
      timezone: "Europe/London",
      quietHours: null,
    });
    expect(getSettings(h.deps)).toEqual({ timezone: "Europe/London", quietHours: null });
  });

  it.each([
    [{ timezone: "Nowhere/Special" }],
    [{ quietHours: { start: "24:00", end: "07:00" } }],
    [{ quietHours: { start: "22:00", end: "7am" } }],
  ])("rejects %j and changes nothing", (patch) => {
    const h = harness();
    expect(updateSettings(h.deps, patch)).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(h.repo.settings).toBeNull();
  });
});
