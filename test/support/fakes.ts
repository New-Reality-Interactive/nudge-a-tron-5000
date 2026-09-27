import type { Temporal } from "temporal-polyfill";
import type { Clock, IdGenerator } from "../../src/app/ports";

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  #now: Temporal.Instant;

  constructor(start: Temporal.Instant) {
    this.#now = start;
  }

  now(): Temporal.Instant {
    return this.#now;
  }

  set(instant: Temporal.Instant): void {
    this.#now = instant;
  }

  advance(by: Temporal.DurationLike): void {
    this.#now = this.#now.add(by);
  }
}

/** Ids `${prefix}-000001`, `${prefix}-000002`, …, which also sort in creation order. */
export class SequentialIdGenerator implements IdGenerator {
  #count = 0;
  readonly #prefix: string;

  constructor(prefix = "id") {
    this.#prefix = prefix;
  }

  next(): string {
    this.#count++;
    return `${this.#prefix}-${String(this.#count).padStart(6, "0")}`;
  }
}
