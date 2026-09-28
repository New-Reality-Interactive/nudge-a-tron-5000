import { beforeAll, describe, expect, it } from "vitest";
import { call, createReminder, expectProblem, newUser, reminderBody, type TestUser } from "./api";

let user: TestUser;
beforeAll(async () => {
  user = await newUser();
});

/** Posts a reminder and expects a 400 whose `errors` include `path`. */
async function rejected(body: unknown, path: string, init: { contentType?: string } = {}) {
  const res = await call("POST", "/v0/reminders", {
    key: user.key,
    body,
    ...(init.contentType !== undefined ? { headers: { "Content-Type": init.contentType } } : {}),
  });
  const problem = await expectProblem(res, 400, "validation-failed");
  expect(problem.errors?.map((e) => e.path)).toContain(path);
  for (const e of problem.errors ?? []) expect(e.message).not.toBe("");
  return problem;
}

describe("RRULE limits", () => {
  it.each([
    ["SECONDLY", "FREQ=SECONDLY"],
    ["no FREQ", "INTERVAL=2"],
    ["an unknown FREQ", "FREQ=FORTNIGHTLY"],
    ["COUNT over 1000", "FREQ=DAILY;COUNT=1001"],
    ["COUNT of 0", "FREQ=DAILY;COUNT=0"],
    ["INTERVAL of 0", "FREQ=DAILY;INTERVAL=0"],
    ["INTERVAL over 1000", "FREQ=DAILY;INTERVAL=1001"],
    ["two BYSECOND values (sub-minute)", "FREQ=MINUTELY;BYSECOND=0,30"],
    ["COUNT with UNTIL", "FREQ=DAILY;COUNT=3;UNTIL=20301231T000000Z"],
    ["an RRULE: prefix", "RRULE:FREQ=DAILY"],
    ["an unknown part", "FREQ=DAILY;X-NAME=1"],
    ["a duplicate part", "FREQ=DAILY;FREQ=WEEKLY"],
    ["over 500 characters", `FREQ=DAILY;BYHOUR=${"1,".repeat(250)}1`],
  ])("rejects %s", async (_, rrule) => {
    await rejected(reminderBody({ rrule }), "rrule");
  });

  it("rejects a rule the recurrence library can't parse", async () => {
    await rejected(reminderBody({ rrule: "FREQ=DAILY;BYDAY=XX" }), "rrule");
  });

  it("accepts a minutely rule with one BYSECOND", async () => {
    await createReminder(user, { rrule: "FREQ=MINUTELY;BYSECOND=15;COUNT=1000" });
  });

  it("applies the limits to a PATCH too", async () => {
    const r = await createReminder(user);
    const res = await call("PATCH", `/v0/reminders/${r.id}`, {
      key: user.key,
      body: { rrule: "FREQ=SECONDLY" },
    });
    await expectProblem(res, 400, "validation-failed");
  });
});

describe("dtstart and time zones", () => {
  it("rejects a dtstart in a DST gap", async () => {
    const problem = await rejected(
      reminderBody({ dtstart: "2030-03-10T02:30", timezone: "America/New_York" }),
      "dtstart",
    );
    expect(problem.detail).toMatch(/daylight-saving gap/);
  });

  it("rejects a PATCH that moves an existing dtstart into a gap by changing only the time zone", async () => {
    const r = await createReminder(user, { dtstart: "2030-03-10T02:30", timezone: "UTC" });
    const res = await call("PATCH", `/v0/reminders/${r.id}`, {
      key: user.key,
      body: { timezone: "America/New_York" },
    });
    const problem = await expectProblem(res, 400, "validation-failed");
    expect(problem.errors).toEqual([{ path: "dtstart", message: expect.stringMatching(/gap/) }]);
  });

  it.each([
    ["an unknown time zone", { timezone: "Mars/Olympus_Mons" }, "timezone"],
    ["a lowercase time zone", { timezone: "america/new_york" }, "timezone"],
    ["a date-time as the time zone", { timezone: "2020-01-01T00:00Z" }, "timezone"],
    ["a fixed offset as the time zone", { timezone: "+05:00" }, "timezone"],
    ["a dtstart with an offset", { dtstart: "2030-06-10T09:00Z" }, "dtstart"],
    ["a date-only dtstart", { dtstart: "2030-06-10" }, "dtstart"],
    ["an impossible date", { dtstart: "2030-02-30T09:00" }, "dtstart"],
  ])("rejects %s", async (_, overrides, path) => {
    await rejected(reminderBody(overrides), path);
  });
});

describe("fields", () => {
  it.each([
    ["a missing title", { title: undefined }, "title"],
    ["a blank title", { title: "   " }, "title"],
    ["a 201-character title", { title: "x".repeat(201) }, "title"],
    ["a 2001-character body", { body: "x".repeat(2001) }, "body"],
    ["an unknown strength", { strength: "brutal" }, "strength"],
    ["maxAttempts over 100", { cap: { maxAttempts: 101 } }, "cap.maxAttempts"],
    ["maxAttempts of 0", { cap: { maxAttempts: 0 } }, "cap.maxAttempts"],
    [
      "maxDurationMinutes over 7 days",
      { cap: { maxDurationMinutes: 10081 } },
      "cap.maxDurationMinutes",
    ],
    ["a fractional maxAttempts", { cap: { maxAttempts: 1.5 } }, "cap.maxAttempts"],
    ["an unknown cap field", { cap: { forever: true } }, "cap"],
    ["an unknown field", { colour: "red" }, ""],
  ])("rejects %s", async (_, overrides, path) => {
    await rejected(reminderBody(overrides), path);
  });

  it("accepts the limits themselves", async () => {
    await createReminder(user, {
      title: "x".repeat(200),
      body: "x".repeat(2000),
      cap: { maxAttempts: 100, maxDurationMinutes: 10080 },
    });
  });

  it("lists every invalid field at once", async () => {
    const problem = await rejected(reminderBody({ title: "", strength: "brutal" }), "title");
    expect(new Set(problem.errors?.map((e) => e.path))).toEqual(new Set(["strength", "title"]));
  });

  it("rejects read-only fields sent back in a PATCH", async () => {
    const r = await createReminder(user);
    const res = await call("PATCH", `/v0/reminders/${r.id}`, {
      key: user.key,
      body: { ...r, title: "New" },
    });
    await expectProblem(res, 400, "validation-failed");
  });
});

describe("request bodies", () => {
  it("rejects malformed JSON", async () => {
    await rejected("{not json", "body");
  });

  it("rejects a body that isn't application/json", async () => {
    await rejected(JSON.stringify(reminderBody()), "header.content-type", {
      contentType: "text/plain",
    });
  });

  it("rejects a PATCH that isn't application/json rather than ignoring it", async () => {
    const r = await createReminder(user);
    const res = await call("PATCH", `/v0/reminders/${r.id}`, {
      key: user.key,
      body: JSON.stringify({ title: "New" }),
      headers: { "Content-Type": "text/plain" },
    });
    await expectProblem(res, 400, "validation-failed");
  });
});

describe("/me", () => {
  it.each([
    ["an unknown time zone", { timezone: "Nowhere/Special" }, "timezone"],
    [
      "quiet hours that aren't HH:MM",
      { quietHours: { start: "7pm", end: "07:00" } },
      "quietHours.start",
    ],
    ["half of the quiet hours", { quietHours: { start: "22:00" } }, "quietHours.end"],
    ["an unknown field", { name: "New name" }, ""],
  ])("rejects %s", async (_, body, path) => {
    const res = await call("PATCH", "/v0/me", { key: user.key, body });
    const problem = await expectProblem(res, 400, "validation-failed");
    expect(problem.errors?.map((e) => e.path)).toContain(path);
  });
});

describe("query parameters", () => {
  it.each([
    ["limit=0", "query.limit"],
    ["limit=201", "query.limit"],
    ["limit=ten", "query.limit"],
    ["cursor=%21%21", "query.cursor"],
  ])("rejects %s", async (query, path) => {
    const res = await call("GET", `/v0/reminders?${query}`, { key: user.key });
    const problem = await expectProblem(res, 400, "validation-failed");
    expect(problem.errors?.map((e) => e.path)).toContain(path);
  });
});

describe("admin input", () => {
  it.each([
    ["a blank name", { name: " ", timezone: "UTC" }, "name"],
    ["a 101-character name", { name: "x".repeat(101), timezone: "UTC" }, "name"],
    ["an unknown time zone", { name: "Ada", timezone: "Atlantis/Capital" }, "timezone"],
  ])("rejects %s", async (_, body, path) => {
    const res = await call("POST", "/v0/admin/users", { key: "test-admin-key", body });
    const problem = await expectProblem(res, 400, "validation-failed");
    expect(problem.errors?.map((e) => e.path)).toContain(path);
  });
});
