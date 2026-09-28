import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "../../../src/app/settings";
import { isTimeZone } from "../../../src/app/shared";
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
    [{ timezone: "Nowhere/Special" }, "timezone"],
    [{ quietHours: { start: "24:00", end: "07:00" } }, "quietHours"],
    [{ quietHours: { start: "22:00", end: "7am" } }, "quietHours"],
  ])("rejects %j and changes nothing", (patch, field) => {
    const h = harness();
    expect(updateSettings(h.deps, patch)).toMatchObject({
      ok: false,
      error: { code: "INVALID", field },
    });
    expect(h.repo.settings).toBeNull();
  });
});

describe("isTimeZone", () => {
  it.each(["America/New_York", "Europe/London", "UTC", "Etc/GMT+5", "US/Eastern"])(
    "accepts the IANA name %s",
    (tz) => {
      expect(isTimeZone(tz)).toBe(true);
    },
  );

  it.each([
    ["another casing", "america/new_york"],
    ["a UTC date-time", "2020-01-01T00:00Z"],
    ["a date-time with a zone", "2020-01-01T00:00+01:00[Europe/Paris]"],
    ["a fixed offset", "+05:00"],
    ["a negative offset", "-0800"],
    ["an unknown name", "Mars/Olympus_Mons"],
    ["an empty string", ""],
  ])("rejects %s", (_, tz) => {
    expect(isTimeZone(tz)).toBe(false);
  });
});
