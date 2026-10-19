import { describe, expect, it, vi } from "vitest";
import { RetryableError, parseRetryAfter, withBackoff } from "./backoff";
import { BudgetExhaustedError, CallBudget, DEFAULT_MAX_CALLS } from "./budget";

const noSleep = (_ms: number) => Promise.resolve();

describe("CallBudget", () => {
  it("defaults to 20 calls and refuses the 21st without spending", () => {
    const budget = new CallBudget();
    expect(budget.cap).toBe(DEFAULT_MAX_CALLS);
    expect(DEFAULT_MAX_CALLS).toBe(20);
    for (let i = 0; i < 20; i++) budget.take();
    expect(() => budget.take()).toThrow(BudgetExhaustedError);
    expect(budget.used).toBe(20);
    expect(budget.remaining).toBe(0);
  });

  it("rejects nonsense caps", () => {
    expect(() => new CallBudget(-1)).toThrow(RangeError);
    expect(() => new CallBudget(1.5)).toThrow(RangeError);
    expect(() => new CallBudget(0).take()).toThrow(BudgetExhaustedError);
  });
});

describe("withBackoff", () => {
  it("retries rate limits with exponential backoff, then succeeds", async () => {
    const budget = new CallBudget(10);
    const sleep = vi.fn(noSleep);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RetryableError("429"))
      .mockRejectedValueOnce(new RetryableError("429"))
      .mockResolvedValue("ok");
    await expect(withBackoff(fn, { budget, sleep, random: () => 0.5, baseDelayMs: 1000 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => Math.round(ms))).toEqual([750, 1500]);
    expect(budget.used).toBe(3);
  });

  it("honours the server's retry hint, capped at maxDelayMs", async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new RetryableError("429", 30_000)).mockRejectedValueOnce(new RetryableError("429", 999_000)).mockResolvedValue("ok");
    await withBackoff(fn, { budget: new CallBudget(5), sleep, random: () => 0, maxDelayMs: 60_000 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([30_000, 60_000]);
  });

  it("counts retries against the call cap and stops when it runs out", async () => {
    const budget = new CallBudget(3);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new RetryableError("429"));
    await expect(withBackoff(fn, { budget, sleep: noSleep, maxAttempts: 10 })).rejects.toThrow(BudgetExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new RetryableError("503"));
    await expect(withBackoff(fn, { budget: new CallBudget(20), sleep: noSleep, maxAttempts: 4 })).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not retry other errors", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("400 bad request"));
    await expect(withBackoff(fn, { budget: new CallBudget(20), sleep: noSleep })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter("Sun, 18 Oct 2026 12:00:30 GMT", new Date("2026-10-18T12:00:00Z"))).toBe(30_000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
