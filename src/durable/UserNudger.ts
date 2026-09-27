import { DurableObject } from "cloudflare:workers";

/**
 * One instance per user (`idFromName(userId)`), SQLite-backed.
 * Stub for Milestone 1 so the binding and migration validate; the alarm loop,
 * schema and outbox arrive in Milestone 3.
 */
export class UserNudger extends DurableObject<Env> {}
