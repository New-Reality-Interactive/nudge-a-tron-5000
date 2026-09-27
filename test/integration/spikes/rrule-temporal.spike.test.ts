/**
 * THROWAWAY SPIKE (Milestone 1) — see docs/adr/0004-temporal-and-rrule-for-recurrence.md.
 *
 * Proves rrule-temporal + temporal-polyfill run inside workerd and produce
 * DST-correct wall-clock occurrences. Delete once src/domain/recurrence.ts has
 * its own unit and property tests (Milestone 2).
 */
import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

const TZ = "America/New_York";

function dailyAtNine(start: string): RRuleTemporal<Temporal.ZonedDateTime> {
  return new RRuleTemporal({
    temporal: Temporal,
    rruleString: "FREQ=DAILY",
    dtstart: Temporal.ZonedDateTime.from(`${start}T09:00[${TZ}]`),
  });
}

const summarise = (occ: Temporal.ZonedDateTime[]) =>
  occ.map((z) => ({
    local: z.toPlainDateTime().toString(),
    offset: z.offset,
    utc: z.toInstant().toString(),
  }));

const gapsInHours = (occ: Temporal.ZonedDateTime[]) =>
  occ.slice(1).map((z, i) => {
    const prev = occ[i];
    if (!prev) throw new Error("unreachable");
    return (z.epochMilliseconds - prev.epochMilliseconds) / 3_600_000;
  });

describe("spike: rrule-temporal in workerd", () => {
  it("runs in workerd, where Temporal is not native (so the polyfill is required)", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
    expect((globalThis as { Temporal?: unknown }).Temporal).toBeUndefined();
  });

  it("FREQ=DAILY 09:00 America/New_York stays at 09:00 local across the March transition", () => {
    // DST starts Sun 2026-03-08 02:00 EST -> 03:00 EDT.
    const occ = dailyAtNine("2026-03-06").all((_, i) => i < 5);

    expect(summarise(occ)).toEqual([
      { local: "2026-03-06T09:00:00", offset: "-05:00", utc: "2026-03-06T14:00:00Z" },
      { local: "2026-03-07T09:00:00", offset: "-05:00", utc: "2026-03-07T14:00:00Z" },
      { local: "2026-03-08T09:00:00", offset: "-04:00", utc: "2026-03-08T13:00:00Z" },
      { local: "2026-03-09T09:00:00", offset: "-04:00", utc: "2026-03-09T13:00:00Z" },
      { local: "2026-03-10T09:00:00", offset: "-04:00", utc: "2026-03-10T13:00:00Z" },
    ]);
    expect(gapsInHours(occ)).toEqual([24, 23, 24, 24]);
  });

  it("FREQ=DAILY 09:00 America/New_York stays at 09:00 local across the November transition", () => {
    // DST ends Sun 2026-11-01 02:00 EDT -> 01:00 EST.
    const occ = dailyAtNine("2026-10-30").all((_, i) => i < 5);

    expect(summarise(occ)).toEqual([
      { local: "2026-10-30T09:00:00", offset: "-04:00", utc: "2026-10-30T13:00:00Z" },
      { local: "2026-10-31T09:00:00", offset: "-04:00", utc: "2026-10-31T13:00:00Z" },
      { local: "2026-11-01T09:00:00", offset: "-05:00", utc: "2026-11-01T14:00:00Z" },
      { local: "2026-11-02T09:00:00", offset: "-05:00", utc: "2026-11-02T14:00:00Z" },
      { local: "2026-11-03T09:00:00", offset: "-05:00", utc: "2026-11-03T14:00:00Z" },
    ]);
    expect(gapsInHours(occ)).toEqual([24, 25, 24, 24]);
  });

  it("next(after) resolves the first occurrence after an instant across a transition", () => {
    const rule = dailyAtNine("2026-01-01");
    // 2026-03-07 14:30Z = 09:30 EST, just after Saturday's occurrence.
    const after = Temporal.Instant.from("2026-03-07T14:30:00Z").toZonedDateTimeISO(TZ);
    const next = rule.next(after);

    expect(next?.toString()).toBe("2026-03-08T09:00:00-04:00[America/New_York]");
  });
});
