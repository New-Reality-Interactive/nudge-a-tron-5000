import { describe, expect, it } from "vitest";
import {
  call,
  controlTime,
  createReminder,
  expectJson,
  expectProblem,
  fireAlarm,
  newUser,
  type Reminder,
  reminderBody,
} from "./api";

type Page<T> = { items: T[]; nextCursor: string | null };

const listReminders = async (key: string) =>
  (await expectJson<Page<Reminder>>(await call("GET", "/v0/reminders", { key }), 200)).items;

describe("Idempotency-Key", () => {
  it("replays the first response for the same key and body, and creates once", async () => {
    const user = await newUser();
    const send = (body: Record<string, unknown>) =>
      call("POST", "/v0/reminders", {
        key: user.key,
        body,
        headers: { "Idempotency-Key": "create-1" },
      });

    const first = await expectJson<Reminder>(await send(reminderBody()), 201);
    // Same body with its keys in another order: still the same request.
    const reordered = Object.fromEntries(Object.entries(reminderBody()).reverse());
    const replay = await expectJson<Reminder>(await send(reordered), 201);

    expect(replay).toEqual(first);
    expect(await listReminders(user.key)).toEqual([first]);
  });

  it("rejects the same key with a different body with 409", async () => {
    const user = await newUser();
    const headers = { "Idempotency-Key": "create-2" };
    await expectJson(
      await call("POST", "/v0/reminders", { key: user.key, body: reminderBody(), headers }),
      201,
    );
    await expectProblem(
      await call("POST", "/v0/reminders", {
        key: user.key,
        body: reminderBody({ title: "Something else" }),
        headers,
      }),
      409,
      "idempotency-conflict",
    );
    expect(await listReminders(user.key)).toHaveLength(1);
  });

  it("rejects a key reused on another route with 409", async () => {
    const user = await newUser();
    const clock = await controlTime(user);
    const r = await createReminder(user);
    await fireAlarm(user, clock);
    const [occ] = (
      await expectJson<Page<{ id: string }>>(
        await call("GET", `/v0/reminders/${r.id}/occurrences`, { key: user.key }),
        200,
      )
    ).items;
    const headers = { "Idempotency-Key": "shared" };
    await expectJson(
      await call("POST", "/v0/reminders", { key: user.key, body: reminderBody(), headers }),
      201,
    );
    await expectProblem(
      await call("POST", `/v0/occurrences/${occ?.id}/ack`, { key: user.key, headers }),
      409,
      "idempotency-conflict",
    );
  });

  it("replays an ack, returning the first outcome", async () => {
    const user = await newUser();
    const clock = await controlTime(user);
    const r = await createReminder(user);
    await fireAlarm(user, clock);
    const [occ] = (
      await expectJson<Page<{ id: string }>>(
        await call("GET", `/v0/reminders/${r.id}/occurrences`, { key: user.key }),
        200,
      )
    ).items;
    const ack = () =>
      call("POST", `/v0/occurrences/${occ?.id}/ack`, {
        key: user.key,
        headers: { "Idempotency-Key": "ack-1" },
      });

    const first = await expectJson(await ack(), 200);
    expect(first).toMatchObject({ outcome: "acked" });
    // Without the key, a second ack says already_closed; with it, the first answer replays.
    expect(await expectJson(await ack(), 200)).toEqual(first);
  });

  it("keeps keys per user", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const headers = { "Idempotency-Key": "same-key" };
    await expectJson(
      await call("POST", "/v0/reminders", { key: a.key, body: reminderBody(), headers }),
      201,
    );
    await expectJson(
      await call("POST", "/v0/reminders", {
        key: b.key,
        body: reminderBody({ title: "B's" }),
        headers,
      }),
      201,
    );
  });

  it("stores nothing for a request that fails validation", async () => {
    const user = await newUser();
    const headers = { "Idempotency-Key": "invalid-first" };
    await expectProblem(
      await call("POST", "/v0/reminders", {
        key: user.key,
        body: reminderBody({ strength: "brutal" }),
        headers,
      }),
      400,
      "validation-failed",
    );
    await expectJson(
      await call("POST", "/v0/reminders", { key: user.key, body: reminderBody(), headers }),
      201,
    );
  });

  it("rejects a malformed key", async () => {
    const user = await newUser();
    const body = await expectProblem(
      await call("POST", "/v0/reminders", {
        key: user.key,
        body: reminderBody(),
        headers: { "Idempotency-Key": "x".repeat(256) },
      }),
      400,
      "validation-failed",
    );
    expect(body.errors?.[0]?.path).toBe("header.idempotency-key");
  });
});
