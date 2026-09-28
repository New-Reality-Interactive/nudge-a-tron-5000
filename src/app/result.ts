export type AppErrorCode = "NOT_FOUND" | "INVALID" | "CONFLICT";

export interface AppError {
  code: AppErrorCode;
  message: string;
  /** The input field at fault, when there is one (e.g. `dtstart`). */
  field?: string;
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

export const invalid = (message: string, field?: string): AppResult<never> => ({
  ok: false,
  error: { code: "INVALID", message, ...(field !== undefined ? { field } : {}) },
});

export const conflict = (message: string): AppResult<never> => ({
  ok: false,
  error: { code: "CONFLICT", message },
});
