import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { FakeClock, SequentialIdGenerator } from "../../support/fakes";

describe("FakeClock", () => {
  it("stays put until set or advanced", () => {
    const clock = new FakeClock(Temporal.Instant.from("2026-06-10T13:00:00Z"));
    expect(clock.now().toString()).toBe("2026-06-10T13:00:00Z");

    clock.advance({ minutes: 90 });
    expect(clock.now().toString()).toBe("2026-06-10T14:30:00Z");

    clock.set(Temporal.Instant.from("2027-01-01T00:00:00Z"));
    expect(clock.now().toString()).toBe("2027-01-01T00:00:00Z");
  });
});

describe("SequentialIdGenerator", () => {
  it("yields padded ids in creation order", () => {
    const ids = new SequentialIdGenerator("occ");
    expect([ids.next(), ids.next()]).toEqual(["occ-000001", "occ-000002"]);
    expect(new SequentialIdGenerator().next()).toBe("id-000001");
  });
});
