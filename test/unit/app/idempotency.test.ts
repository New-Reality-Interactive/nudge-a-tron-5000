import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  fingerprint,
  IDEMPOTENCY_TTL_HOURS,
  idempotent,
} from "../../../src/app/idempotency";
import { acknowledge } from "../../../src/app/occurrences";
import { createReminder } from "../../../src/app/reminders";
import { harness, reminderInput, runAlarm, value } from "./harness";

const REQ = { key: "key-1", fingerprint: "fp-1" };

describe("idempotent", () => {
  it("runs without a key every time", () => {
    const h = harness();
    idempotent(h.deps, undefined, () => createReminder(h.deps, reminderInput()));
    idempotent(h.deps, undefined, () => createReminder(h.deps, reminderInput()));
    expect(h.repo.reminders.size).toBe(2);
    expect(h.repo.idempotency.size).toBe(0);
  });

  it("runs once per key and replays the stored result", () => {
    const h = harness();
    const run = () => idempotent(h.deps, REQ, () => createReminder(h.deps, reminderInput()));
    const first = run();
    expect(run()).toEqual(first);
    expect(h.repo.reminders.size).toBe(1);
  });

  it("returns CONFLICT for the same key with another fingerprint, without running", () => {
    const h = harness();
    value(idempotent(h.deps, REQ, () => createReminder(h.deps, reminderInput())));
    const other = idempotent(h.deps, { ...REQ, fingerprint: "fp-2" }, () =>
      createReminder(h.deps, reminderInput()),
    );
    expect(other).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(h.repo.reminders.size).toBe(1);
  });

  it("stores and replays an error result too", () => {
    const h = harness();
    const first = idempotent(h.deps, REQ, () => acknowledge(h.deps, "nope"));
    expect(first).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(idempotent(h.deps, REQ, () => acknowledge(h.deps, "nope"))).toEqual(first);
  });

  it("replays the first ack's outcome, not a fresh already_closed", async () => {
    const h = harness();
    const r = value(createReminder(h.deps, reminderInput()));
    await runAlarm(h);
    const [occ] = h.repo.listOccurrences(r.id);
    const ack = () => idempotent(h.deps, REQ, () => acknowledge(h.deps, occ?.id as string));
    expect(value(ack()).outcome).toBe("acked");
    expect(value(ack()).outcome).toBe("acked");
  });

  it("forgets a key once it expires, so it can be used again", () => {
    const h = harness();
    value(idempotent(h.deps, REQ, () => createReminder(h.deps, reminderInput())));
    h.clock.advance({ milliseconds: IDEMPOTENCY_TTL_HOURS * 3_600_000 - 1 });
    idempotent(h.deps, REQ, () => createReminder(h.deps, reminderInput()));
    expect(h.repo.reminders.size).toBe(1);

    h.clock.advance({ milliseconds: 1 });
    const again = idempotent(h.deps, { ...REQ, fingerprint: "fp-2" }, () =>
      createReminder(h.deps, reminderInput()),
    );
    expect(again.ok).toBe(true);
    expect(h.repo.reminders.size).toBe(2);
  });

  it("stores nothing when the operation throws", () => {
    const h = harness();
    expect(() =>
      idempotent(h.deps, REQ, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(h.repo.idempotency.size).toBe(0);
  });
});

describe("canonicalJson and fingerprint", () => {
  it("ignores key order at every level, but not array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("differs by method, path and body", async () => {
    const base = await fingerprint("POST", "/v0/reminders", { a: 1 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint("post", "/v0/reminders", { a: 1 })).toBe(base);
    expect(await fingerprint("PATCH", "/v0/reminders", { a: 1 })).not.toBe(base);
    expect(await fingerprint("POST", "/v0/other", { a: 1 })).not.toBe(base);
    expect(await fingerprint("POST", "/v0/reminders", { a: 2 })).not.toBe(base);
    expect(await fingerprint("POST", "/v0/x", undefined)).toBe(
      await fingerprint("POST", "/v0/x", null),
    );
  });
});
