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

describe("tenancy", () => {
  it("user B can never see or change user A's reminders, occurrences or events", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const clock = await controlTime(a);
    const reminder = await createReminder(a, { rrule: "FREQ=DAILY" });
    await fireAlarm(a, clock);
    const [occ] = (
      await expectJson<Page<{ id: string }>>(
        await call("GET", `/v0/reminders/${reminder.id}/occurrences`, { key: a.key }),
        200,
      )
    ).items;
    const occurrenceId = occ?.id as string;
    const before = await expectJson<Reminder>(
      await call("GET", `/v0/reminders/${reminder.id}`, { key: a.key }),
      200,
    );

    const list = await expectJson<Page<Reminder>>(
      await call("GET", "/v0/reminders", { key: b.key }),
      200,
    );
    expect(list.items).toEqual([]);

    for (const [method, path, body] of [
      ["GET", `/v0/reminders/${reminder.id}`, undefined],
      ["PATCH", `/v0/reminders/${reminder.id}`, { title: "Pwned" }],
      ["DELETE", `/v0/reminders/${reminder.id}`, undefined],
      ["GET", `/v0/reminders/${reminder.id}/occurrences`, undefined],
      ["GET", `/v0/occurrences/${occurrenceId}/events`, undefined],
      ["POST", `/v0/occurrences/${occurrenceId}/ack`, undefined],
    ] as const) {
      await expectProblem(
        await call(method, path, { key: b.key, ...(body ? { body } : {}) }),
        404,
        "not-found",
      );
    }

    // A's reminder and open occurrence are untouched.
    expect(
      await expectJson(await call("GET", `/v0/reminders/${reminder.id}`, { key: a.key }), 200),
    ).toEqual(before);
    const occurrences = await expectJson<Page<{ state: string }>>(
      await call("GET", `/v0/reminders/${reminder.id}/occurrences`, { key: a.key }),
      200,
    );
    expect(occurrences.items[0]?.state).toBe("NAGGING");
  });

  it("a cursor from user A's list shows user B nothing of A's", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await createReminder(a);
    await createReminder(a);
    const page = await expectJson<Page<Reminder>>(
      await call("GET", "/v0/reminders?limit=1", { key: a.key }),
      200,
    );
    const other = await expectJson<Page<Reminder>>(
      await call("GET", `/v0/reminders?cursor=${page.nextCursor}`, { key: b.key }),
      200,
    );
    expect(other).toEqual({ items: [], nextCursor: null });
  });
});
