import { describe, expect, it } from "vitest";
import { buildOpportunity } from "./extract/extractOpportunity";
import { hashText } from "./hash";
import { approvePending, formatFieldTable, formatRejected, rejectPending, terminalSafe } from "./review";
import { PAGE, PAGE_URL, goodResponse } from "./testFixtures";
import type { PendingRecord } from "./types";

const extracted = buildOpportunity(goodResponse(), PAGE, PAGE_URL, "2026-10-18T16:00:00.000Z");
type ReadyRecord = Extract<PendingRecord, { opportunity: object }>;
const record = (overrides: Partial<ReadyRecord> = {}): PendingRecord => ({
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

describe("formatRejected (--show-rejected)", () => {
  const rejected = {
    itemKey: "page:https://hack.example/",
    sourceUrl: "https://hack.example/",
    reason: "required fields missing or unverified: location",
    fields: [
      { field: "name", status: "kept" as const, value: "Hack Example", quote: "Hack Example 2026", basis: "stated" as const },
      {
        field: "location",
        status: "discarded" as const,
        value: { venue: null, city: "London", region: null, country: null },
        quote: "Join us in London",
        basis: "stated" as const,
        reason: "country is not stated and can't be derived from a stated province or state",
      },
      { field: "registrationFee", status: "missing" as const, value: null, quote: null, basis: null },
    ],
  };

  it("prints the reason and every field with value, basis, quote and kept/discarded reason", () => {
    const out = formatRejected([rejected], 120);
    expect(out).toContain("REJECTED page:https://hack.example/");
    expect(out).toContain("Reason: required fields missing or unverified: location");
    expect(out).toMatch(/✓ name: Hack Example\s+│ “Hack Example 2026”/);
    // Read the two columns separately: wrapping interleaves them line by line.
    const rows = out.split("\n").filter((l) => l.includes(" │ "));
    const left = rows.map((l) => l.split(" │ ")[0].trim()).join(" ");
    const right = rows.map((l) => l.split(" │ ")[1].trim()).join(" ");
    expect(left).toContain('✗ location: venue: null, city: "London", region: null, Country not stated');
    expect(right).toContain("“Join us in London” → country is not stated and can't be derived from a stated province or state");
    expect(out).toContain("Not stated (null): registrationFee");
  });

  it("never prints the API key, even if it somehow appears in page or model text", () => {
    const key = "AIzaSyFAKE-key-1234567890";
    const leaky = { ...rejected, reason: `model echoed ${key}`, fields: [{ ...rejected.fields[0], quote: `Hack ${key}` }] };
    const out = formatRejected([leaky], 120, [key]);
    expect(out).not.toContain(key);
    expect(out).toContain("[redacted]");
  });

  it("handles a record with no readable fields", () => {
    expect(formatRejected([{ ...rejected, reason: "model output is not a JSON object", fields: [] }])).toContain("(no fields: the model output could not be read)");
  });

  it("strips terminal escape sequences from page-derived text", () => {
    const out = formatRejected([{ ...rejected, reason: "bad \u001b[2Jreason" }]);
    expect(out).not.toContain("\u001b");
  });
});

describe("review display of derived and time-split fields", () => {
  it("labels the derived timezone and shows a separate time quote", () => {
    const table = formatFieldTable(
      [
        { field: "start", status: "kept", value: "2027-01-09T10:00", quote: "Saturday, January 9, 2027", timeQuote: "Doors open at 10:00 AM", basis: "stated", reason: "time from the separate time quote" },
        { field: "timezone", status: "kept", value: "America/Toronto", quote: "Where: Fictional Hall, Waterloo, ON", basis: "derived from stated location", reason: "Waterloo, ON → America/Toronto (city table)" },
        { field: "location", status: "kept", value: { venue: "Fictional Hall", city: "Waterloo", region: "ON", country: null }, quote: "Where: Fictional Hall, Waterloo, ON", basis: "stated" },
      ],
      140,
    );
    expect(table).toContain("timezone [DERIVED FROM STATED LOCATION]: America/Toronto");
    expect(table).toContain("time: “Doors open at 10:00 AM”");
    const left = table.split("\n").filter((l) => l.includes(" │ ")).map((l) => l.split(" │ ")[0].trim()).join(" ");
    expect(left).toContain('location: venue: "Fictional Hall", city: "Waterloo", region: "ON", Country not stated');
  });

  it("explains why a required field is missing", () => {
    const table = formatFieldTable([{ field: "timezone", status: "missing", value: null, quote: null, basis: null, reason: "online event: no stated location to derive it from" }]);
    expect(table).toContain("Not stated (null): timezone (online event: no stated location to derive it from)");
  });
});
