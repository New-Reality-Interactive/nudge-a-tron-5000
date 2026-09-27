export type AppErrorCode = "NOT_FOUND" | "INVALID";

export interface AppError {
  code: AppErrorCode;
  message: string;
}

/**
 * What a use case returns. Errors are values, not exceptions, because they cross
 * Durable Object RPC, and a thrown error loses its type on the way.
 */
export type AppResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): AppResult<T> => ({ ok: true, value });

export const notFound = (what: string): AppResult<never> => ({
  ok: false,
  error: { code: "NOT_FOUND", message: `${what} not found` },
});

export const invalid = (message: string): AppResult<never> => ({
  ok: false,
  error: { code: "INVALID", message },
});
