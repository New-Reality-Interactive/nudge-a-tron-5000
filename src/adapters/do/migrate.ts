export interface Migration {
  /** 1, 2, 3, … with no gaps, matching the file's `NNNN_` prefix. */
  version: number;
  name: string;
  /** One or more SQL statements. */
  sql: string;
}

/**
 * Brings a Durable Object's SQLite schema up to date (ADR 0006). Applies every migration
 * newer than the highest recorded version, in order, each in its own transaction
 * together with its row in the tracking table, so a migration is recorded exactly when
 * it has been applied. A failure throws and leaves the later ones for the next attempt.
 * Returns the versions it applied.
 *
 * Call it from the constructor inside `blockConcurrencyWhile`, so nothing runs against
 * an old schema. `table` exists for tests that need a tracking table of their own.
 */
export function runMigrations(
  storage: DurableObjectStorage,
  migrations: readonly Migration[],
  appliedAt: number,
  table = "_migrations",
): number[] {
  const { sql } = storage;
  sql.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (
       version    INTEGER PRIMARY KEY,
       name       TEXT    NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  const current = sql
    .exec<{ version: number | null }>(`SELECT MAX(version) AS version FROM ${table}`)
    .one().version;

  const applied: number[] = [];
  for (const m of migrations) {
    if (current !== null && m.version <= current) continue;
    storage.transactionSync(() => {
      sql.exec(m.sql);
      sql.exec(
        `INSERT INTO ${table} (version, name, applied_at) VALUES (?, ?, ?)`,
        m.version,
        m.name,
        appliedAt,
      );
    });
    applied.push(m.version);
  }
  return applied;
}
