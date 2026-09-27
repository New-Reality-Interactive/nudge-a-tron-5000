import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { type Migration, runMigrations } from "../../src/adapters/do/migrate";
import { MIGRATIONS } from "../../src/durable/migrations";
import type { UserNudger } from "../../src/durable/UserNudger";

const fresh = () => env.USER_NUDGER.getByName(`migrations-${crypto.randomUUID()}`);

type Applied = { version: number; name: string; applied_at: number };

const applied = (stub: DurableObjectStub<UserNudger>, table = "_migrations") =>
  runInDurableObject(stub, (_: UserNudger, state) =>
    state.storage.sql
      .exec<Applied>(`SELECT version, name, applied_at FROM ${table} ORDER BY version`)
      .toArray(),
  );

const tables = (stub: DurableObjectStub<UserNudger>) =>
  runInDurableObject(stub, (_: UserNudger, state) =>
    state.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
      )
      .toArray()
      .map((r) => r.name),
  );

// Fake migrations run against a tracking table of their own, on top of the real schema.
const V1: Migration = { version: 1, name: "0001_a", sql: "CREATE TABLE mig_a (id INTEGER);" };
const V2: Migration = {
  version: 2,
  name: "0002_b",
  sql: "CREATE TABLE mig_b (id INTEGER); INSERT INTO mig_a (id) VALUES (2);",
};
const TEST_TABLE = "_test_migrations";

describe("DO schema migrations", () => {
  it("runs every migration on a fresh object before it serves a request", async () => {
    const stub = fresh();
    expect(await stub.listReminders()).toEqual([]);

    expect((await applied(stub)).map((m) => [m.version, m.name])).toEqual(
      MIGRATIONS.map((m) => [m.version, m.name]),
    );
    expect(await tables(stub)).toEqual([
      "events",
      "occurrences",
      "outbox",
      "reminders",
      "settings",
    ]);
  });

  it("does nothing when the object starts again", async () => {
    const stub = fresh();
    await stub.listReminders();
    const before = await applied(stub);

    await evictDurableObject(stub);
    await stub.listReminders();

    expect(await applied(stub)).toEqual(before);
  });

  it("runs only the migrations newer than the object's version", async () => {
    const stub = fresh();
    const results = await runInDurableObject(stub, (_: UserNudger, state) => {
      const first = runMigrations(state.storage, [V1], 1, TEST_TABLE);
      const second = runMigrations(state.storage, [V1, V2], 2, TEST_TABLE);
      const third = runMigrations(state.storage, [V1, V2], 3, TEST_TABLE);
      const rows = state.storage.sql
        .exec<{ id: number }>("SELECT id FROM mig_a")
        .toArray()
        .map((r) => r.id);
      return { first, second, third, rows };
    });

    expect(results).toEqual({ first: [1], second: [2], third: [], rows: [2] });
    expect(await applied(stub, TEST_TABLE)).toEqual([
      { version: 1, name: "0001_a", applied_at: 1 },
      { version: 2, name: "0002_b", applied_at: 2 },
    ]);
  });

  it("rolls back a failing migration, records nothing for it, and retries it next time", async () => {
    const stub = fresh();
    const broken: Migration = {
      version: 2,
      name: "0002_broken",
      sql: "CREATE TABLE mig_c (id INTEGER); INSERT INTO no_such_table VALUES (1);",
    };
    const outcome = await runInDurableObject(stub, (_: UserNudger, state) => {
      runMigrations(state.storage, [V1], 1, TEST_TABLE);
      let error = "";
      try {
        runMigrations(state.storage, [V1, broken], 2, TEST_TABLE);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const hasC = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'mig_c'")
        .toArray().length;
      return { error, hasC, retried: runMigrations(state.storage, [V1, V2], 3, TEST_TABLE) };
    });

    expect(outcome.error).toMatch(/no such table/);
    expect(outcome.hasC).toBe(0);
    expect(outcome.retried).toEqual([2]);
  });
});
