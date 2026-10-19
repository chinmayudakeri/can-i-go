/**
 * Hard cap on extraction calls per ingest run. Every provider request,
 * retries included, spends one unit, so a run can never make more than `cap`
 * calls no matter what a page or the provider does.
 */

export const DEFAULT_MAX_CALLS = 20;

export class BudgetExhaustedError extends Error {
  constructor(readonly cap: number) {
    super(`extraction call cap reached (${cap} per run)`);
  }
}

export class CallBudget {
  private spent = 0;

  constructor(readonly cap: number = DEFAULT_MAX_CALLS) {
    if (!Number.isInteger(cap) || cap < 0) throw new RangeError(`call cap must be a whole number ≥ 0, got ${cap}`);
  }

  get used(): number {
    return this.spent;
  }

  get remaining(): number {
    return this.cap - this.spent;
  }

  /** Spends one call, or throws `BudgetExhaustedError` without spending. */
  take(): void {
    if (this.spent >= this.cap) throw new BudgetExhaustedError(this.cap);
    this.spent++;
  }
}
