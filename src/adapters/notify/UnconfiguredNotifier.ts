import type { Notifier } from "../../app/ports";

/**
 * Production notifier until the ntfy adapter lands (Milestone 5). Every send fails, so
 * nags go through the outbox's retries and end up DEAD instead of pretending to be sent.
 */
export class UnconfiguredNotifier implements Notifier {
  send(): Promise<void> {
    return Promise.reject(new Error("no notifier configured"));
  }
}
