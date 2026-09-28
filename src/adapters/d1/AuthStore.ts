import { Temporal } from "temporal-polyfill";
import type { ApiKeyRecord, AuthStore, UserRecord } from "../../app/ports";

// Instants are stored as INTEGER epoch milliseconds (see migrations/d1/0001_init.sql).

type UserRow = { id: string; name: string; timezone: string; created_at: number };

type KeyWithUserRow = {
  key_id: string;
  user_id: string;
  secret_hash: string;
  key_created_at: number;
  revoked_at: number | null;
  name: string;
  timezone: string;
  user_created_at: number;
};

const instant = (value: number): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(value);

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  createdAt: instant(row.created_at),
});

/** `AuthStore` on D1: the `users` and `api_keys` tables. */
export class D1AuthStore implements AuthStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async findKey(keyId: string): Promise<{ key: ApiKeyRecord; user: UserRecord } | null> {
    const row = await this.#db
      .prepare(
        `SELECT k.key_id, k.user_id, k.secret_hash, k.created_at AS key_created_at,
           k.revoked_at, u.name, u.timezone, u.created_at AS user_created_at
         FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE k.key_id = ?`,
      )
      .bind(keyId)
      .first<KeyWithUserRow>();
    if (row === null) return null;
    return {
      key: {
        keyId: row.key_id,
        userId: row.user_id,
        secretHash: row.secret_hash,
        createdAt: instant(row.key_created_at),
        revokedAt: row.revoked_at === null ? null : instant(row.revoked_at),
      },
      user: toUser({
        id: row.user_id,
        name: row.name,
        timezone: row.timezone,
        created_at: row.user_created_at,
      }),
    };
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const row = await this.#db
      .prepare("SELECT id, name, timezone, created_at FROM users WHERE id = ?")
      .bind(id)
      .first<UserRow>();
    return row === null ? null : toUser(row);
  }

  async insertUser(user: UserRecord): Promise<void> {
    await this.#db
      .prepare("INSERT INTO users (id, name, timezone, created_at) VALUES (?, ?, ?, ?)")
      .bind(user.id, user.name, user.timezone, user.createdAt.epochMilliseconds)
      .run();
  }

  async updateUserTimezone(id: string, timezone: string): Promise<void> {
    await this.#db.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(timezone, id).run();
  }

  async insertKey(key: ApiKeyRecord): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO api_keys (key_id, user_id, secret_hash, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        key.keyId,
        key.userId,
        key.secretHash,
        key.createdAt.epochMilliseconds,
        key.revokedAt?.epochMilliseconds ?? null,
      )
      .run();
  }

  async revokeKey(userId: string, keyId: string, at: Temporal.Instant): Promise<boolean> {
    // SQLite counts every row the WHERE matched, so an already-revoked key still counts.
    const result = await this.#db
      .prepare(
        "UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE key_id = ? AND user_id = ?",
      )
      .bind(at.epochMilliseconds, keyId, userId)
      .run();
    return result.meta.changes > 0;
  }
}
