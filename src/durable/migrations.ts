import init from "../../migrations/do/0001_init.sql";
import idempotency from "../../migrations/do/0002_idempotency.sql";
import type { Migration } from "../adapters/do/migrate";

/** Every DO schema migration, in order. Add new files here; a unit test checks the list. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "0001_init", sql: init },
  { version: 2, name: "0002_idempotency", sql: idempotency },
];
