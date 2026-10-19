import { describe, expect, it } from "vitest";
import { formatMoney, summarizeCosts } from "./costs";
import { makeOpportunity } from "./testFixtures";

const cad = (amount: number) => ({ amount, currency: "CAD" });
const line = (s: ReturnType<typeof summarizeCosts>, key: string) => s.lines.find((l) => l.key === key);

describe("summarizeCosts", () => {
  it("totals a single-day event when every cost is known", () => {
    const s = summarizeCosts(makeOpportunity());
    expect(s.complete).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.knownTotal).toEqual(cad(30));
    expect(line(s, "lodging")).toBeUndefined();
  });

  it("lists an unknown fee as missing and marks the summary incomplete", () => {
    const s = summarizeCosts(makeOpportunity({ registrationFee: null }));
    expect(s.complete).toBe(false);
    expect(s.missing).toEqual(["Registration fee"]);
    expect(s.knownTotal).toEqual(cad(20)); // partial sum only, must not be shown as a total
  });

  it("has no known total when no cost is known", () => {
    const s = summarizeCosts(makeOpportunity({ registrationFee: null, travelCostEstimate: null }));
    expect(s.knownTotal).toBeNull();
    expect(s.complete).toBe(false);
    expect(s.missing).toEqual(["Registration fee", "Travel"]);
  });

  it("has zero travel for online events, even with no travel estimate", () => {
    const s = summarizeCosts(makeOpportunity({ format: "online", location: null, travelCostEstimate: null }));
    expect(line(s, "travel")?.amount).toEqual(cad(0));
    expect(s.complete).toBe(true);
  });

  it("has zero travel when the organizer fully covers it", () => {
    const s = summarizeCosts(makeOpportunity({ travelSupport: "full", travelCostEstimate: null }));
    expect(line(s, "travel")?.amount).toEqual(cad(0));
  });

  it("adds an unknown lodging line for multi-day in-person events", () => {
    const s = summarizeCosts(makeOpportunity({ end: "2026-11-15T17:00:00-05:00" }));
    expect(line(s, "lodging")?.amount).toBeNull();
    expect(s.missing).toContain("Lodging");
    expect(s.complete).toBe(false);
  });

  it("does not count lodging when the organizer provides it", () => {
    const s = summarizeCosts(makeOpportunity({ end: "2026-11-15T17:00:00-05:00", lodgingSupport: "full" }));
    expect(line(s, "lodging")?.amount).toEqual(cad(0));
    expect(s.complete).toBe(true);
  });

  it("refuses to sum mixed currencies", () => {
    const s = summarizeCosts(makeOpportunity({ travelCostEstimate: { amount: 20, currency: "USD" } }));
    expect(s.knownTotal).toBeNull();
    expect(s.complete).toBe(false);
  });

  it("defaults zero-cost lines to CAD when nothing else is priced", () => {
    const s = summarizeCosts(
      makeOpportunity({ format: "online", location: null, registrationFee: null, travelCostEstimate: null }),
    );
    expect(line(s, "travel")?.amount).toEqual(cad(0));
  });
});

describe("formatMoney", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatMoney(cad(0))).toBe("$0");
    expect(formatMoney(cad(25))).toBe("$25");
    expect(formatMoney(cad(12.5))).toBe("$12.50");
  });

  it("marks non-CAD amounts so they can't be mistaken for CAD", () => {
    expect(formatMoney({ amount: 25, currency: "USD" })).toBe("US$25");
  });
});
