import type { CallBudget } from "./budget";

/** Thrown by providers for rate limits (HTTP 429, RESOURCE_EXHAUSTED) and temporary outages (503). */
export class RetryableError extends Error {
  constructor(
    message: string,
    /** Server-requested wait, from Retry-After or the provider's retry hint. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null | undefined, now: Date = new Date()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now.getTime());
}

export interface BackoffOptions {
  /** Each attempt spends one call from this budget. */
  budget: CallBudget;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Returns [0, 1). Injected so tests are deterministic. */
  random?: () => number;
}

/**
 * Calls `fn`, retrying `RetryableError`s with exponential backoff and jitter.
 * Honours the server's retry hint when it gives one (capped at `maxDelayMs`).
 * Any other error is rethrown immediately. Throws `BudgetExhaustedError` when
 * the budget runs out, even mid-retry.
 */
export async function withBackoff<T>(fn: () => Promise<T>, options: BackoffOptions): Promise<T> {
  const { budget, maxAttempts = 5, baseDelayMs = 2_000, maxDelayMs = 60_000, sleep = defaultSleep, random = Math.random } = options;
  for (let attempt = 1; ; attempt++) {
    budget.take();
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt >= maxAttempts) throw err;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jittered = exponential / 2 + random() * (exponential / 2);
      await sleep(Math.min(maxDelayMs, Math.max(err.retryAfterMs ?? 0, jittered)));
    }
  }
}
