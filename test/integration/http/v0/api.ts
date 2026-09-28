import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { Temporal } from "temporal-polyfill";
import { expect } from "vitest";
import { UuidV7IdGenerator } from "../../../../src/adapters/system/UuidV7IdGenerator";
import type { UserNudger } from "../../../../src/durable/UserNudger";
import { FakeClock, FakeNotifier } from "../../../support/fakes";
import { T0 } from "../../nudger";

/** Set as a binding in vitest.config.ts. */
export const ADMIN_KEY = "test-admin-key";

export interface Call {
  key?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A request to the Worker. A `body` is sent as JSON. */
export function call(method: string, path: string, options: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.key !== undefined) headers.Authorization = `Bearer ${options.key}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers["Content-Type"] ??= "application/json";
  }
  return exports.default.fetch(`https://nudge.test${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

/** The JSON body of a response that must have `status`. */
export async function expectJson<T = Record<string, unknown>>(
  res: Response,
  status: number,
): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  return JSON.parse(text) as T;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
}

/** The problem body of a response that must be a problem with `status` and `type`. */
export async function expectProblem(
  res: Response,
  status: number,
  type: string,
): Promise<ProblemBody> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  const body = JSON.parse(text) as ProblemBody;
  expect(body).toMatchObject({ type: `/problems/${type}`, status });
  expect(text).not.toMatch(/\bat .*\.(ts|js):\d+/); // no stack trace
  return body;
}

export interface TestUser {
  id: string;
  key: string;
  keyId: string;
}

let users = 0;

/** A new user with one API key, made through the admin routes. */
export async function newUser(timezone = "UTC"): Promise<TestUser> {
  users++;
  const user = await expectJson<{ id: string }>(
    await call("POST", "/v0/admin/users", {
      key: ADMIN_KEY,
      body: { name: `User ${users}`, timezone },
    }),
    201,
  );
  const issued = await expectJson<{ key: string; keyId: string }>(
    await call("POST", `/v0/admin/users/${user.id}/keys`, { key: ADMIN_KEY }),
    201,
  );
  return { id: user.id, key: issued.key, keyId: issued.keyId };
}

export const reminderBody = (overrides: Record<string, unknown> = {}) => ({
  title: "Take the bins out",
  dtstart: "2030-06-10T09:00",
  timezone: "UTC",
  strength: "firm",
  ...overrides,
});

export interface Reminder {
  id: string;
  [field: string]: unknown;
}

export async function createReminder(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<Reminder> {
  return expectJson<Reminder>(
    await call("POST", "/v0/reminders", { key: user.key, body: reminderBody(overrides) }),
    201,
  );
}

/**
 * Gives the user's Durable Object a fake clock, so tests can run its alarm. Call it
 * before the first reminder is created: the clock decides where the schedule starts.
 */
export async function controlTime(user: TestUser, start = T0): Promise<FakeClock> {
  const clock = new FakeClock(start);
  await runInDurableObject(env.USER_NUDGER.getByName(user.id), (instance: UserNudger) => {
    instance.deps = { clock, ids: new UuidV7IdGenerator(clock), notifier: new FakeNotifier() };
  });
  return clock;
}

/** Moves the clock to the user's next alarm and runs it. */
export async function fireAlarm(user: TestUser, clock: FakeClock): Promise<Temporal.Instant> {
  const stub = env.USER_NUDGER.getByName(user.id);
  const at = await runInDurableObject(stub, (_: UserNudger, state) => state.storage.getAlarm());
  if (at === null) throw new Error("no alarm scheduled");
  clock.set(Temporal.Instant.fromEpochMilliseconds(at));
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  return clock.now();
}
