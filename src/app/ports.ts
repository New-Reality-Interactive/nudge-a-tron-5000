import type { Temporal } from "temporal-polyfill";

/** The only source of "now" for use cases. Production reads the system clock. */
export interface Clock {
  now(): Temporal.Instant;
}

/** Source of entity ids. Production uses UUIDv7 (Milestone 3); tests use sequential ids. */
export interface IdGenerator {
  next(): string;
}
