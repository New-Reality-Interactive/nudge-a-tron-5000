import type { Clock, IdGenerator } from "../../app/ports";

/** Fills `bytes` with random values. */
export type RandomSource = (bytes: Uint8Array) => void;

const cryptoRandom: RandomSource = (bytes) => {
  crypto.getRandomValues(bytes);
};

/**
 * UUIDv7 (RFC 9562 §5.7): a 48-bit Unix millisecond timestamp from the injected `Clock`,
 * the version and variant bits, and 74 random bits. Ids from different milliseconds
 * sort by time.
 */
export class UuidV7IdGenerator implements IdGenerator {
  readonly #clock: Clock;
  readonly #random: RandomSource;

  constructor(clock: Clock, random: RandomSource = cryptoRandom) {
    this.#clock = clock;
    this.#random = random;
  }

  next(): string {
    const bytes = new Uint8Array(16);
    this.#random(bytes);

    let ms = BigInt(this.#clock.now().epochMilliseconds);
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(ms & 0xffn);
      ms >>= 8n;
    }
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variant 10

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
