import type { UserRecord } from "../app/ports";

/** Hono's environment for every route: the Worker's bindings and per-request variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by `requireUser`. */
    user: UserRecord;
  };
};
