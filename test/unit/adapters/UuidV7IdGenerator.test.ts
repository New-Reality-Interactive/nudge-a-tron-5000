import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { UuidV7IdGenerator } from "../../../src/adapters/system/UuidV7IdGenerator";
import { FakeClock } from "../../support/fakes";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UuidV7IdGenerator", () => {
  it("puts the clock's millisecond timestamp in the first 48 bits (RFC 9562 test vector)", () => {
    // RFC 9562 Appendix A.6: 2022-02-22T19:22:22.000Z is 0x017F22E279B0.
    const clock = new FakeClock(Temporal.Instant.from("2022-02-22T19:22:22Z"));
    const id = new UuidV7IdGenerator(clock, (bytes) => bytes.fill(0)).next();
    expect(id).toBe("017f22e2-79b0-7000-8000-000000000000");
  });

  it("sets the version and variant bits whatever the random bytes are", () => {
    const clock = new FakeClock(Temporal.Instant.from("2030-01-01T00:00:00Z"));
    const id = new UuidV7IdGenerator(clock, (bytes) => bytes.fill(0xff)).next();
    expect(id).toMatch(UUID_V7);
    expect(id.slice(14)).toBe("7fff-bfff-ffffffffffff");
  });

  it("produces distinct, valid ids from crypto randomness", () => {
    const gen = new UuidV7IdGenerator(new FakeClock(Temporal.Instant.from("2030-01-01T00:00:00Z")));
    const ids = Array.from({ length: 100 }, () => gen.next());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(100);
  });

  it("sorts ids from later milliseconds after earlier ones", () => {
    const clock = new FakeClock(Temporal.Instant.from("2030-01-01T00:00:00Z"));
    const gen = new UuidV7IdGenerator(clock);
    const first = gen.next();
    clock.advance({ milliseconds: 1 });
    expect(gen.next() > first).toBe(true);
  });
});
