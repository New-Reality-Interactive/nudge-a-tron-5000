import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  authenticate,
  base32,
  constantTimeEqual,
  hashSecret,
  issueApiKey,
  parseApiKey,
  revokeApiKey,
  sha256,
  verifyAdminKey,
} from "../../../src/app/auth";
import type { UserRecord } from "../../../src/app/ports";
import { countingRandom, FakeClock, InMemoryAuthStore } from "../../support/fakes";
import { T0, value } from "./harness";

const ADA: UserRecord = { id: "user-1", name: "Ada", timezone: "UTC", createdAt: T0 };

async function setup() {
  const store = new InMemoryAuthStore();
  await store.insertUser(ADA);
  const clock = new FakeClock(T0);
  const deps = { clock, random: countingRandom() };
  return { store, clock, deps };
}

describe("base32", () => {
  it("matches the RFC 4648 test vectors, lowercase and unpadded", () => {
    const enc = (s: string) => base32(new TextEncoder().encode(s));
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("my");
    expect(enc("fo")).toBe("mzxq");
    expect(enc("foo")).toBe("mzxw6");
    expect(enc("foob")).toBe("mzxw6yq");
    expect(enc("fooba")).toBe("mzxw6ytb");
    expect(enc("foobar")).toBe("mzxw6ytboi");
  });

  it("never produces the key separator", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(base32(bytes)).toMatch(/^[a-z2-7]*$/);
      }),
    );
  });
});

describe("parseApiKey", () => {
  const keyId = "a".repeat(16);
  const secret = "b".repeat(52);

  it("splits a well-formed key", () => {
    expect(parseApiKey(`nt5k_${keyId}_${secret}`)).toEqual({ keyId, secret });
  });

  it.each([
    ["the wrong prefix", `nt4k_${keyId}_${secret}`],
    ["a short key id", `nt5k_${"a".repeat(15)}_${secret}`],
    ["a short secret", `nt5k_${keyId}_${"b".repeat(51)}`],
    ["a long secret", `nt5k_${keyId}_${"b".repeat(53)}`],
    ["uppercase", `nt5k_${keyId.toUpperCase()}_${secret}`],
    ["characters outside base32", `nt5k_${keyId}_${"1".repeat(52)}`],
    ["surrounding text", ` nt5k_${keyId}_${secret}`],
    ["an empty string", ""],
  ])("rejects %s", (_, raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });
});

describe("hashing and comparing", () => {
  it("hashes a secret to lowercase hex SHA-256", async () => {
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares bytes for equality, and unequal lengths as different", () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([1, 2]))).toBe(false);
    fc.assert(
      fc.property(fc.uint8Array(), fc.uint8Array(), (x, y) => {
        const same = x.length === y.length && x.every((b, i) => b === y[i]);
        expect(constantTimeEqual(x, y)).toBe(same);
      }),
    );
  });

  it("verifies the admin key, and never matches an unset or empty one", async () => {
    expect(await verifyAdminKey("s3cret", "s3cret")).toBe(true);
    expect(await verifyAdminKey("s3cret", "s3cret!")).toBe(false);
    expect(await verifyAdminKey("", "")).toBe(false);
    expect(await verifyAdminKey("anything", undefined)).toBe(false);
  });

  it("sha256 is 32 bytes whatever the input length", async () => {
    expect((await sha256("")).length).toBe(32);
    expect((await sha256("x".repeat(10_000))).length).toBe(32);
  });
});

describe("issueApiKey", () => {
  it("returns the full key once and stores only the secret's hash", async () => {
    const { store, deps } = await setup();
    const issued = value(await issueApiKey(store, deps, ADA.id));

    expect(issued).toEqual({
      keyId: "aaaqeayeaudaocaj",
      key: expect.stringMatching(/^nt5k_aaaqeayeaudaocaj_[a-z2-7]{52}$/),
      userId: ADA.id,
      createdAt: T0.toString(),
    });
    const secret = parseApiKey(issued.key)?.secret as string;
    const stored = store.keys.get(issued.keyId);
    expect(stored).toEqual({
      keyId: issued.keyId,
      userId: ADA.id,
      secretHash: await hashSecret(secret),
      createdAt: T0,
      revokedAt: null,
    });
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it("returns NOT_FOUND for an unknown user", async () => {
    const { store, deps } = await setup();
    expect(await issueApiKey(store, deps, "nobody")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(store.keys.size).toBe(0);
  });
});

describe("authenticate", () => {
  it("returns the key's user for a valid key", async () => {
    const { store, deps } = await setup();
    const { key } = value(await issueApiKey(store, deps, ADA.id));
    expect(await authenticate(store, key)).toEqual(ADA);
  });

  it("returns null for a malformed, unknown or wrong key", async () => {
    const { store, deps } = await setup();
    const { key, keyId } = value(await issueApiKey(store, deps, ADA.id));
    expect(await authenticate(store, "garbage")).toBeNull();
    expect(await authenticate(store, key.replace(keyId, "z".repeat(16)))).toBeNull();
    expect(await authenticate(store, `nt5k_${keyId}_${"a".repeat(52)}`)).toBeNull();
  });

  it("returns null once the key is revoked", async () => {
    const { store, clock, deps } = await setup();
    const { key, keyId } = value(await issueApiKey(store, deps, ADA.id));
    expect(value(await revokeApiKey(store, clock, ADA.id, keyId))).toBeNull();
    expect(await authenticate(store, key)).toBeNull();
  });
});

describe("revokeApiKey", () => {
  it("keeps the first revocation time when revoked again", async () => {
    const { store, clock, deps } = await setup();
    const { keyId } = value(await issueApiKey(store, deps, ADA.id));
    value(await revokeApiKey(store, clock, ADA.id, keyId));
    clock.advance({ hours: 1 });
    value(await revokeApiKey(store, clock, ADA.id, keyId));
    expect(store.keys.get(keyId)?.revokedAt).toEqual(T0);
  });

  it("returns NOT_FOUND for an unknown key or another user's key", async () => {
    const { store, clock, deps } = await setup();
    const { keyId } = value(await issueApiKey(store, deps, ADA.id));
    expect(await revokeApiKey(store, clock, ADA.id, "nope")).toMatchObject({ ok: false });
    expect(await revokeApiKey(store, clock, "user-2", keyId)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(store.keys.get(keyId)?.revokedAt).toBeNull();
  });
});
