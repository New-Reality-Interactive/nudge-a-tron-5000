import { env } from "cloudflare:workers";
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
} from "./api";

type Page<T> = { items: T[]; nextCursor: string | null };
type Occurrence = { id: string; state: string; [field: string]: unknown };
type Event = { type: string; data: Record<string, unknown> };

describe("reminders", () => {
  it("create, read, list, change and delete, end to end through the Durable Object", async () => {
    const user = await newUser();
    const created = await createReminder(user, {
      body: "Green bin",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      cap: { maxAttempts: 5 },
    });
    expect(created).toEqual({
      id: expect.any(String),
      title: "Take the bins out",
      body: "Green bin",
      dtstart: "2030-06-10T09:00:00",
      timezone: "UTC",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      strength: "firm",
      cap: { maxAttempts: 5 },
      status: "ACTIVE",
      nextOccurrenceAt: "2030-06-10T09:00:00Z",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const path = `/v0/reminders/${created.id}`;
    expect(await expectJson(await call("GET", path, { key: user.key }), 200)).toEqual(created);
    const list = await expectJson<Page<Reminder>>(
      await call("GET", "/v0/reminders", { key: user.key }),
      200,
    );
    expect(list).toEqual({ items: [created], nextCursor: null });

    const changed = await expectJson<Reminder>(
      await call("PATCH", path, {
        key: user.key,
        body: { title: "Bins", body: null, strength: "relentless", cap: {} },
      }),
      200,
    );
    expect(changed).toMatchObject({ title: "Bins", body: null, strength: "relentless", cap: {} });
    expect(changed.dtstart).toBe(created.dtstart);

    const deleted = await call("DELETE", path, { key: user.key });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    await expectProblem(await call("GET", path, { key: user.key }), 404, "not-found");
    await expectProblem(await call("DELETE", path, { key: user.key }), 404, "not-found");
    const after = await expectJson<Page<Reminder>>(
      await call("GET", "/v0/reminders", { key: user.key }),
      200,
    );
    expect(after.items).toEqual([]);
  });

  it("makes a one-shot out of a recurring reminder with rrule: null", async () => {
    const user = await newUser();
    const r = await createReminder(user, { rrule: "FREQ=DAILY" });
    const changed = await expectJson<Reminder>(
      await call("PATCH", `/v0/reminders/${r.id}`, { key: user.key, body: { rrule: null } }),
      200,
    );
    expect(changed.rrule).toBeNull();
  });

  it("pages through reminders with a cursor", async () => {
    const user = await newUser();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createReminder(user, { title: `r${i}` })).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? "?limit=2" : `?limit=2&cursor=${cursor}`;
      const page: Page<Reminder> = await expectJson<Page<Reminder>>(
        await call("GET", `/v0/reminders${query}`, { key: user.key }),
        200,
      );
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null);

    expect(seen).toEqual(ids);
    expect(pages).toBe(3);
  });
});

describe("occurrences, events and acknowledging", () => {
  it("lists occurrences and their events, and an ack stops the nagging", async () => {
    const user = await newUser();
    const clock = await controlTime(user);
    const r = await createReminder(user, { rrule: "FREQ=DAILY" });
    await fireAlarm(user, clock); // the first occurrence and its first nag
    await fireAlarm(user, clock); // the second nag

    const occurrences = await expectJson<Page<Occurrence>>(
      await call("GET", `/v0/reminders/${r.id}/occurrences`, { key: user.key }),
      200,
    );
    expect(occurrences.items).toHaveLength(1);
    const occ = occurrences.items[0] as Occurrence;
    expect(occ).toMatchObject({
      reminderId: r.id,
      scheduledFor: "2030-06-10T09:00:00Z",
      state: "NAGGING",
      attempts: 2,
      level: 1,
      closeReason: null,
    });

    const ackPath = `/v0/occurrences/${occ.id}/ack`;
    const acked = await expectJson(await call("POST", ackPath, { key: user.key }), 200);
    expect(acked).toMatchObject({ outcome: "acked", occurrence: { id: occ.id, state: "ACKED" } });
    const again = await expectJson(await call("POST", ackPath, { key: user.key }), 200);
    expect(again).toMatchObject({ outcome: "already_closed", occurrence: { state: "ACKED" } });

    const events = await expectJson<Page<Event>>(
      await call("GET", `/v0/occurrences/${occ.id}/events`, { key: user.key }),
      200,
    );
    expect(events.items.map((e) => e.type)).toEqual(["SCHEDULED", "NAG_SENT", "NAG_SENT", "ACKED"]);
    expect(events.items[1]).toMatchObject({
      at: "2030-06-10T09:00:00Z",
      data: { attempt: 1, level: 0, priority: 3 },
    });
    expect(events.items[3]?.data).toEqual({});

    const page = await expectJson<Page<Event>>(
      await call("GET", `/v0/occurrences/${occ.id}/events?limit=3`, { key: user.key }),
      200,
    );
    expect(page.items).toHaveLength(3);
    const rest = await expectJson<Page<Event>>(
      await call("GET", `/v0/occurrences/${occ.id}/events?limit=3&cursor=${page.nextCursor}`, {
        key: user.key,
      }),
      200,
    );
    expect(rest).toMatchObject({ items: [{ type: "ACKED" }], nextCursor: null });
  });

  it("cancels the open occurrence when its reminder is deleted", async () => {
    const user = await newUser();
    const clock = await controlTime(user);
    const r = await createReminder(user, { rrule: "FREQ=DAILY" });
    await fireAlarm(user, clock);
    const [occ] = (
      await expectJson<Page<Occurrence>>(
        await call("GET", `/v0/reminders/${r.id}/occurrences`, { key: user.key }),
        200,
      )
    ).items;

    expect((await call("DELETE", `/v0/reminders/${r.id}`, { key: user.key })).status).toBe(204);

    // The occurrence and its history stay readable by id.
    const events = await expectJson<Page<Event>>(
      await call("GET", `/v0/occurrences/${occ?.id}/events`, { key: user.key }),
      200,
    );
    expect(events.items.at(-1)?.type).toBe("CANCELLED");
    const ack = await expectJson(
      await call("POST", `/v0/occurrences/${occ?.id}/ack`, { key: user.key }),
      200,
    );
    expect(ack).toMatchObject({ outcome: "already_closed", occurrence: { state: "CANCELLED" } });
    await expectProblem(
      await call("GET", `/v0/reminders/${r.id}/occurrences`, { key: user.key }),
      404,
      "not-found",
    );
  });

  it("returns 404 for unknown ids", async () => {
    const user = await newUser();
    for (const [method, path] of [
      ["GET", "/v0/reminders/nope"],
      ["PATCH", "/v0/reminders/nope"],
      ["DELETE", "/v0/reminders/nope"],
      ["GET", "/v0/reminders/nope/occurrences"],
      ["GET", "/v0/occurrences/nope/events"],
      ["POST", "/v0/occurrences/nope/ack"],
    ] as const) {
      const body = method === "PATCH" ? { title: "x" } : undefined;
      await expectProblem(
        await call(method, path, { key: user.key, ...(body ? { body } : {}) }),
        404,
        "not-found",
      );
    }
  });
});

describe("/me", () => {
  it("changes the time zone and quiet hours in the Durable Object and the time zone in D1", async () => {
    const user = await newUser();
    const me = await expectJson(
      await call("PATCH", "/v0/me", {
        key: user.key,
        body: { timezone: "America/New_York", quietHours: { start: "22:00", end: "07:00" } },
      }),
      200,
    );
    expect(me).toEqual({
      id: user.id,
      name: expect.any(String),
      timezone: "America/New_York",
      quietHours: { start: "22:00", end: "07:00" },
    });
    expect(await expectJson(await call("GET", "/v0/me", { key: user.key }), 200)).toEqual(me);
    const row = await env.DB.prepare("SELECT timezone FROM users WHERE id = ?")
      .bind(user.id)
      .first();
    expect(row).toEqual({ timezone: "America/New_York" });

    const off = await expectJson(
      await call("PATCH", "/v0/me", { key: user.key, body: { quietHours: null } }),
      200,
    );
    expect(off).toMatchObject({ timezone: "America/New_York", quietHours: null });
  });
});

describe("unknown routes", () => {
  it("get a problem response", async () => {
    await expectProblem(await call("GET", "/v0/nope"), 404, "not-found");
    await expectProblem(await call("GET", "/nope"), 404, "not-found");
  });
});
