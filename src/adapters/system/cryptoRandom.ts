import type { RandomSource } from "../../app/ports";

/** Cryptographically secure random bytes from Web Crypto. */
export const cryptoRandom: RandomSource = (bytes) => {
  crypto.getRandomValues(bytes);
};
