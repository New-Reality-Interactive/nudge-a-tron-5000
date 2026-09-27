import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Temporal } from "temporal-polyfill";
import { expect } from "vitest";
import { UuidV7IdGenerator } from "../../src/adapters/system/UuidV7IdGenerator";
import type { AppResult } from "../../src/app/result";
import type { UserNudger } from "../../src/durable/UserNudger";
import { FakeClock, FakeNotifier } from "../support/fakes";

/**
 * Tests use times in 2030. An alarm set in the past fires straight away in workerd and
 * would race the test; future alarms only run when `runDurableObjectAlarm` says so.
 */
export const T0 = Temporal.Instant.from("2030-06-10T09:00:00Z");

let counter = 0;

export interface TestNudger {
  stub: DurableObjectStub<UserNudger>;
  clock: FakeClock;
  notifier: FakeNotifier;
}

/**
 * A fresh UserNudger (its own name, so its own storage) with a controlled clock and a
 * recording notifier swapped in through `runInDurableObject`. Nothing in production can
 * do this: `deps` isn't reachable over RPC.
 */
export async function testNudger(start = T0): Promise<TestNudger> {
  counter++;
  const stub = env.USER_NUDGER.getByName(`test-user-${counter}-${crypto.randomUUID()}`);
  const clock = new FakeClock(start);
  const notifier = new FakeNotifier();
  await runInDurableObject(stub, (instance: UserNudger) => {
    instance.deps = { clock, ids: new UuidV7IdGenerator(clock), notifier };
  });
  return { stub, clock, notifier };
}

/** The scheduled alarm time, or null when none is set. */
export async function alarmAt(
  stub: DurableObjectStub<UserNudger>,
): Promise<Temporal.Instant | null> {
  const at = await runInDurableObject(stub, (_: UserNudger, state) => state.storage.getAlarm());
  return at === null ? null : Temporal.Instant.fromEpochMilliseconds(at);
}

/** Moves the clock to the scheduled alarm and runs it, as workerd would. */
export async function fireNextAlarm(n: TestNudger): Promise<Temporal.Instant> {
  const at = await alarmAt(n.stub);
  if (at === null) throw new Error("no alarm scheduled");
  n.clock.set(at);
  expect(await runDurableObjectAlarm(n.stub)).toBe(true);
  return at;
}

/** Runs the alarm handler again at the current time: an at-least-once redelivery. */
export async function replayAlarm(n: TestNudger): Promise<void> {
  await runInDurableObject(n.stub, (instance: UserNudger) => instance.alarm());
}

export function value<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`unexpected ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Row counts straight from the object's SQLite. */
export function countRows(n: TestNudger, table: string): Promise<number> {
  return runInDurableObject(
    n.stub,
    (_: UserNudger, state) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n,
  );
}
