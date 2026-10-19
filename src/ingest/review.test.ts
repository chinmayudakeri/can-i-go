import { describe, expect, it } from "vitest";
import { buildOpportunity } from "./extract/extractOpportunity";
import { hashText } from "./hash";
import { approvePending, formatFieldTable, rejectPending, terminalSafe } from "./review";
import { PAGE, PAGE_URL, goodResponse } from "./testFixtures";
import type { PendingRecord } from "./types";

const extracted = buildOpportunity(goodResponse(), PAGE, PAGE_URL, "2026-10-18T16:00:00.000Z");
const record = (overrides: Partial<PendingRecord> = {}): PendingRecord => ({
  opportunity: extracted.opportunity!,
  itemKey: `page:${PAGE_URL}`,
  textHash: hashText(PAGE),
  fetchedAt: "2026-10-18T16:00:00.000Z",
  fields: extracted.fields,
  updateOf: null,
  ...overrides,
});

describe("approvePending / rejectPending", () => {
  it("approve moves the record into listings and marks its source approved", () => {
    const result = approvePending({ pending: [record()], listings: [], state: {} }, 0);
    expect(result).toMatchObject({ action: "added", id: "real-maple-hacks-2026-11-14", pending: [] });
    expect(result.listings).toHaveLength(1);
    expect(result.state[`page:${PAGE_URL}`]).toMatchObject({ outcome: "approved", listingId: "real-maple-hacks-2026-11-14" });
  });

  it("approve refuses records that fail real-listing validation", () => {
    const bad = record({ opportunity: { ...extracted.opportunity!, evidence: {} } });
    expect(() => approvePending({ pending: [bad], listings: [], state: {} }, 0)).toThrow(/missing evidence/);
  });

  it("reject drops the record and remembers the page hash", () => {
    const result = rejectPending({ pending: [record()], listings: [], state: {} }, 0);
    expect(result.pending).toEqual([]);
    expect(result.listings).toEqual([]);
    expect(result.state[`page:${PAGE_URL}`]).toMatchObject({ outcome: "rejected", textHash: hashText(PAGE) });
  });
});

describe("terminal output", () => {
  it("strips escape sequences and other control characters from page text", () => {
    expect(terminalSafe("ok\u001b[2J\u001b]0;pwned\u0007 done‮")).toBe("ok[2J]0;pwned done");
    expect(terminalSafe("line1\nline2\ttab")).toBe("line1\nline2\ttab");
  });

  it("shows each field next to its quote, with discarded reasons and inferred flags", () => {
    const table = formatFieldTable(
      [
        { field: "applicationDeadline", status: "kept", value: "2026-11-01T23:59", quote: "Applications close November 1 at 11:59 PM ET.", basis: "stated" },
        { field: "timezone", status: "kept", value: "America/Toronto", quote: "starting at 9:00 AM ET", basis: "inferred" },
        { field: "registrationFee", status: "discarded", value: { amount: 50, currency: "CAD" }, quote: "Up to $50", basis: "stated", reason: "currency is not stated" },
        { field: "travelCostEstimate", status: "missing", value: null, quote: null, basis: null },
      ],
      100,
    );
    expect(table).toMatch(/KEPT[\s\S]*✓ applicationDeadline: 2026-11-01T23:59\s+│ “Applications close November 1 at 11:59 PM ET\.”/);
    expect(table).toContain("timezone [INFERRED]");
    expect(table).toMatch(/DISCARDED[\s\S]*✗ registrationFee[\s\S]*→ currency is not stated/);
    expect(table).toContain("Not stated (null): travelCostEstimate");
  });
});
