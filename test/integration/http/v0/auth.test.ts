import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ADMIN_KEY, call, expectJson, expectProblem, newUser } from "./api";

describe("user API keys", () => {
  it("accepts a valid key", async () => {
    const user = await newUser();
    const me = await expectJson(await call("GET", "/v0/me", { key: user.key }), 200);
    expect(me).toMatchObject({ id: user.id, timezone: "UTC", quietHours: null });
  });

  it("stores only a hash of the secret", async () => {
    const user = await newUser();
    const secret = user.key.split("_")[2] as string;
    const row = await env.DB.prepare("SELECT * FROM api_keys WHERE key_id = ?")
      .bind(user.keyId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ user_id: user.id, revoked_at: null });
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["no Authorization header", {}],
    ["a non-Bearer scheme", { Authorization: "Basic dXNlcjpwYXNz" }],
    ["a malformed key", { Authorization: "Bearer not-a-key" }],
    ["an unknown key", { Authorization: `Bearer nt5k_aaaaaaaaaaaaaaaa_${"a".repeat(52)}` }],
  ])("rejects %s with 401", async (_, headers) => {
    const res = await call("GET", "/v0/me", { headers });
    const body = await expectProblem(res, 401, "unauthorized");
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer /);
    expect(body.instance).toBe("/v0/me");
  });

  it("rejects a known key id with the wrong secret", async () => {
    const user = await newUser();
    const wrong = `nt5k_${user.keyId}_${"b".repeat(52)}`;
    await expectProblem(await call("GET", "/v0/me", { key: wrong }), 401, "unauthorized");
  });

  it("rejects a revoked key, and revoking again still succeeds", async () => {
    const user = await newUser();
    const path = `/v0/admin/users/${user.id}/keys/${user.keyId}`;
    expect((await call("DELETE", path, { key: ADMIN_KEY })).status).toBe(204);
    await expectProblem(await call("GET", "/v0/me", { key: user.key }), 401, "unauthorized");
    expect((await call("DELETE", path, { key: ADMIN_KEY })).status).toBe(204);
  });

  it("keeps a user's other keys working when one is revoked", async () => {
    const user = await newUser();
    const second = await expectJson<{ key: string }>(
      await call("POST", `/v0/admin/users/${user.id}/keys`, { key: ADMIN_KEY }),
      201,
    );
    await call("DELETE", `/v0/admin/users/${user.id}/keys/${user.keyId}`, { key: ADMIN_KEY });
    expect((await call("GET", "/v0/me", { key: second.key })).status).toBe(200);
  });
});

describe("admin routes", () => {
  it("issue keys in the documented format, once", async () => {
    const user = await newUser();
    expect(user.key).toMatch(/^nt5k_[a-z2-7]{16}_[a-z2-7]{52}$/);
    expect(user.key.split("_")[1]).toBe(user.keyId);
  });

  it.each([
    ["no key", undefined],
    ["the wrong key", "not-the-admin-key"],
    ["a key that differs only in length", `${ADMIN_KEY}x`],
  ])("reject %s with 401", async (_, key) => {
    const res = await call("POST", "/v0/admin/users", {
      ...(key !== undefined ? { key } : {}),
      body: { name: "Mallory", timezone: "UTC" },
    });
    await expectProblem(res, 401, "unauthorized");
  });

  it("reject a valid user key with 403", async () => {
    const user = await newUser();
    await expectProblem(
      await call("POST", `/v0/admin/users/${user.id}/keys`, { key: user.key }),
      403,
      "forbidden",
    );
  });

  it("return 404 for an unknown user or key", async () => {
    const user = await newUser();
    await expectProblem(
      await call("POST", "/v0/admin/users/nobody/keys", { key: ADMIN_KEY }),
      404,
      "not-found",
    );
    await expectProblem(
      await call("DELETE", `/v0/admin/users/${user.id}/keys/aaaaaaaaaaaaaaaa`, { key: ADMIN_KEY }),
      404,
      "not-found",
    );
  });

  it("won't revoke one user's key through another user", async () => {
    const [a, b] = [await newUser(), await newUser()];
    await expectProblem(
      await call("DELETE", `/v0/admin/users/${b.id}/keys/${a.keyId}`, { key: ADMIN_KEY }),
      404,
      "not-found",
    );
    expect((await call("GET", "/v0/me", { key: a.key })).status).toBe(200);
  });

  it("create a user in D1 and seed their Durable Object's time zone", async () => {
    const created = await expectJson<{ id: string; createdAt: string }>(
      await call("POST", "/v0/admin/users", {
        key: ADMIN_KEY,
        body: { name: "Ada", timezone: "Europe/London" },
      }),
      201,
    );
    expect(created).toMatchObject({ name: "Ada", timezone: "Europe/London" });
    const row = await env.DB.prepare("SELECT name, timezone FROM users WHERE id = ?")
      .bind(created.id)
      .first();
    expect(row).toEqual({ name: "Ada", timezone: "Europe/London" });
    expect(await env.USER_NUDGER.getByName(created.id).getSettings()).toEqual({
      timezone: "Europe/London",
      quietHours: null,
    });
  });
});

describe("the D1 schema", () => {
  it("has the users and api_keys tables from migrations/d1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'api_keys') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["api_keys", "users"]);
  });
});
