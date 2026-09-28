import { describe, expect, it } from "vitest";
import { listEvents, listOccurrences } from "../../../src/app/occurrences";
import { probe, toPage } from "../../../src/app/pagination";
import { listReminders } from "../../../src/app/reminders";
import { create, harness, runAlarm, value } from "./harness";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

describe("toPage", () => {
  it("asks the repo for one extra row", () => {
    expect(probe({ limit: 2, after: "x" })).toEqual({ limit: 3, after: "x" });
  });

  it("points at the last item when more follow, and at nothing otherwise", () => {
    const page = { limit: 2, after: null };
    expect(toPage(rows(3), page, (r) => r.id)).toEqual({ items: ["r0", "r1"], nextAfter: "r1" });
    expect(toPage(rows(2), page, (r) => r.id)).toEqual({ items: ["r0", "r1"], nextAfter: null });
    expect(toPage(rows(0), page, (r) => r.id)).toEqual({ items: [], nextAfter: null });
  });
});

describe("paged use cases", () => {
  it("walk every reminder exactly once, skipping deleted ones and surviving a deleted cursor", () => {
    const h = harness();
    const ids = Array.from({ length: 5 }, (_, i) => create(h, { title: `r${i}` }).id);
    const first = listReminders(h.deps, { limit: 2, after: null });
    expect(first.items.map((r) => r.id)).toEqual(ids.slice(0, 2));

    // Deleting the cursor's reminder doesn't lose our place.
    const cursorReminder = h.repo.reminders.get(ids[1] as string);
    if (cursorReminder === undefined) throw new Error("missing reminder");
    h.repo.reminders.set(cursorReminder.id, { ...cursorReminder, status: "DELETED" });
    const second = listReminders(h.deps, { limit: 2, after: first.nextAfter });
    expect(second.items.map((r) => r.id)).toEqual(ids.slice(2, 4));
    const third = listReminders(h.deps, { limit: 2, after: second.nextAfter });
    expect(third).toEqual({ items: [expect.objectContaining({ id: ids[4] })], nextAfter: null });
  });

  it("gives an empty page for an unknown cursor", () => {
    const h = harness();
    create(h);
    expect(listReminders(h.deps, { limit: 5, after: "nope" })).toEqual({
      items: [],
      nextAfter: null,
    });
  });

  it("page occurrences newest first and events oldest first", async () => {
    const h = harness();
    const r = create(h, { rrule: "FREQ=DAILY" });
    for (let day = 0; day < 3; day++) {
      await runAlarm(h);
      h.clock.advance({ hours: 24 });
    }
    const page1 = value(listOccurrences(h.deps, r.id, { limit: 2, after: null }));
    const page2 = value(listOccurrences(h.deps, r.id, { limit: 2, after: page1.nextAfter }));
    expect([...page1.items, ...page2.items].map((o) => o.scheduledFor)).toEqual([
      "2030-06-12T09:00:00Z",
      "2030-06-11T09:00:00Z",
      "2030-06-10T09:00:00Z",
    ]);
    expect(page2.nextAfter).toBeNull();

    const oldest = page2.items[0]?.id as string;
    const events = value(listEvents(h.deps, oldest, { limit: 1, after: null }));
    expect(events.items.map((e) => e.type)).toEqual(["SCHEDULED"]);
    const rest = value(listEvents(h.deps, oldest, { limit: 10, after: events.nextAfter }));
    expect(rest.items.map((e) => e.type)).toEqual(["NAG_SENT", "SUPERSEDED"]);
  });
});
