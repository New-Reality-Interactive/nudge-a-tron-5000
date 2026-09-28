import type { AuthStore, Clock, RandomSource, UserRecord } from "./ports";
import { type AppResult, notFound, ok } from "./result";
import { toHex } from "./shared";

// API keys are `nt5k_<keyId>_<secret>` (ADR 0008). The key id finds the row in D1; only
// SHA-256(secret) is stored, which is enough because the secret is 256 random bits.

export const KEY_PREFIX = "nt5k";
const KEY_ID_BYTES = 10; // 16 base32 characters
const SECRET_BYTES = 32; // 52 base32 characters
const API_KEY = /^nt5k_([a-z2-7]{16})_([a-z2-7]{52})$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Lowercase RFC 4648 base32 without padding. Its alphabet has no `_`. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

export interface ParsedApiKey {
  keyId: string;
  secret: string;
}

/** Splits a presented key into its id and secret, or returns null if it's malformed. */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const match = API_KEY.exec(raw);
  return match === null ? null : { keyId: match[1] as string, secret: match[2] as string };
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** What D1 stores for a key: the lowercase hex SHA-256 of its secret. */
export async function hashSecret(secret: string): Promise<string> {
  return toHex(await sha256(secret));
}

/**
 * Compares two byte strings in time that depends only on their length. Callers compare
 * SHA-256 digests, which are always 32 bytes, so the length gives nothing away either.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Compared against when the key id is unknown, so that case takes as long as a wrong secret. */
const NO_KEY_HASH = "0".repeat(64);

/**
 * The user a presented API key belongs to, or null when the key is malformed, unknown,
 * revoked or has the wrong secret. All of these look the same to the caller. The secret
 * is checked before the revocation, so a wrong secret never reveals that a key id exists.
 */
export async function authenticate(store: AuthStore, raw: string): Promise<UserRecord | null> {
  const parsed = parseApiKey(raw);
  if (parsed === null) return null;

  const found = await store.findKey(parsed.keyId);
  const presented = await sha256(parsed.secret);
  const matches = constantTimeEqual(presented, fromHex(found?.key.secretHash ?? NO_KEY_HASH));
  if (!matches || found === null || found.key.revokedAt !== null) return null;
  return found.user;
}

/**
 * Whether `presented` is the admin key. Both sides are hashed first, so the comparison
 * is constant-time and doesn't leak the configured key's length. An unset or empty admin
 * key never matches.
 */
export async function verifyAdminKey(
  presented: string,
  configured: string | undefined,
): Promise<boolean> {
  if (configured === undefined || configured === "") return false;
  const [a, b] = await Promise.all([sha256(presented), sha256(configured)]);
  return constantTimeEqual(a, b);
}

export interface IssuedKey {
  keyId: string;
  /** The full key. Returned once, never stored. */
  key: string;
  userId: string;
  createdAt: string;
}

/** Creates a new API key for a user. The full key is in the result and nowhere else. */
export async function issueApiKey(
  store: AuthStore,
  deps: { clock: Clock; random: RandomSource },
  userId: string,
): Promise<AppResult<IssuedKey>> {
  if ((await store.getUser(userId)) === null) return notFound("user");

  const random = (length: number) => {
    const bytes = new Uint8Array(length);
    deps.random(bytes);
    return base32(bytes);
  };
  const keyId = random(KEY_ID_BYTES);
  const secret = random(SECRET_BYTES);
  const now = deps.clock.now();
  await store.insertKey({
    keyId,
    userId,
    secretHash: await hashSecret(secret),
    createdAt: now,
    revokedAt: null,
  });
  return ok({ keyId, key: `${KEY_PREFIX}_${keyId}_${secret}`, userId, createdAt: now.toString() });
}

/** Revokes one of a user's keys. Revoking a revoked key succeeds and changes nothing. */
export async function revokeApiKey(
  store: AuthStore,
  clock: Clock,
  userId: string,
  keyId: string,
): Promise<AppResult<null>> {
  return (await store.revokeKey(userId, keyId, clock.now())) ? ok(null) : notFound("API key");
}
