import { describe, expect, it } from "vitest";
import { makeOpportunity } from "./testFixtures";
import type { Opportunity } from "./types";
import { isValidIsoDate, isValidIsoDateTime, parseOpportunities } from "./validate";

const parseOne = (o: unknown, real = false) => parseOpportunities([o], "Test", { real });

describe("parseOpportunities: dates", () => {
  it.each([
    ["start", "2026-11-14"],
    ["start", "2026-11-14T09:00:00"],
    ["start", "2026-02-30T09:00:00-05:00"],
    ["start", "2026-11-14T24:00:00-05:00"],
    ["end", "tomorrow"],
    ["start", "1970-01-01T00:00:00Z"],
    ["end", "2999-01-01T00:00:00Z"],
  ])('rejects %s = "%s"', (key, value) => {
    expect(() => parseOne({ ...makeOpportunity(), [key]: value })).toThrow(new RegExp(`invalid "${key}"`));
  });

  it("rejects an event that ends before it starts, or a deadline after it ends", () => {
    expect(() => parseOne(makeOpportunity({ end: "2026-11-13T09:00:00-05:00" }))).toThrow(/ends before it starts/);
    expect(() => parseOne(makeOpportunity({ applicationDeadline: "2026-11-20T00:00:00-05:00" }))).toThrow(/deadline is after/);
    expect(() => parseOne(makeOpportunity({ applicationDeadline: "Nov 1" }))).toThrow(/applicationDeadline/);
  });

  it("checks lastVerified and timezone", () => {
    expect(() => parseOne(makeOpportunity({ lastVerified: "2026-13-01" }))).toThrow(/lastVerified/);
    expect(() => parseOne(makeOpportunity({ timezone: "EST" }))).toThrow(/timezone/);
  });

  it("date helpers", () => {
    expect(isValidIsoDateTime("2026-11-14T09:00:00-05:00")).toBe(true);
    expect(isValidIsoDateTime("2026-11-14T09:00Z")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
  });
});

describe("parseOpportunities: other fields", () => {
  it.each<[string, Partial<Opportunity>, RegExp]>([
    ["negative fee", { registrationFee: { amount: -5, currency: "CAD" } }, /registrationFee/],
    ["unknown currency", { registrationFee: { amount: 5, currency: "XYZ" } }, /invalid currency/],
    ["lowercase currency", { travelCostEstimate: { amount: 5, currency: "cad" } }, /invalid currency/],
    ["bad support level", { foodSupport: "some" as never }, /foodSupport/],
    ["bad team size", { teamSize: { min: 4, max: 2 } }, /teamSize/],
    ["non-http url", { officialUrl: "javascript:alert(1)" }, /officialUrl/],
    ["bad apply url", { applyUrl: "ftp://x" }, /applyUrl/],
    ["bad sourceUrls", { sourceUrls: ["file:///x"] }, /sourceUrls/],
    ["bad evidence", { evidence: { start: { quote: "", sourceUrl: "https://example.org" } } }, /evidence for "start"/],
  ])("rejects %s", (_name, overrides, message) => {
    expect(() => parseOne(makeOpportunity(overrides))).toThrow(message);
  });

  it("rejects non-object entries", () => {
    expect(() => parseOpportunities([null], "Test")).toThrow(/not an object/);
    expect(() => parseOpportunities(["x"], "Test")).toThrow(/not an object/);
  });
});

describe("parseOpportunities: real listings", () => {
  const src = "https://maple.example";
  const ev = (quote: string) => ({ quote, sourceUrl: src });

  it("requires evidence for every known date, deadline, eligibility and cost field", () => {
    expect(() => parseOne(makeOpportunity(), true)).toThrow(
      /missing evidence for start, end, applicationDeadline, registrationFee, travelCostEstimate, eligibility\.studentStatusRequired/,
    );
  });

  it("accepts a real listing whose known fields all have quotes, and doesn't require quotes for unknowns", () => {
    const opp = makeOpportunity({
      registrationFee: null,
      travelCostEstimate: null,
      applicationDeadline: null,
      eligibility: { studentStatusRequired: true, universities: null, programs: null, years: null, experienceLevels: null, otherRequirements: null },
      evidence: { start: ev("Nov 14, 2026 9am"), end: ev("Nov 14, 2026 5pm"), "eligibility.studentStatusRequired": ev("Students only") },
    });
    expect(parseOne(opp, true)).toHaveLength(1);
  });
});

describe("parseOpportunities: location", () => {
  it("accepts a venue-only location and a missing country", () => {
    const venueOnly = makeOpportunity({ location: { venue: "Fictional Hall", city: null, region: null, country: null } });
    expect(parseOne(venueOnly)).toHaveLength(1);
  });

  it("needs a venue or a city, and text-or-null parts", () => {
    expect(() => parseOne(makeOpportunity({ location: { venue: null, city: null, region: "ON", country: "Canada" } }))).toThrow(/venue or a city/);
    expect(() => parseOne(makeOpportunity({ location: { venue: null, city: "Waterloo", region: null, country: 3 as never } }))).toThrow(/location\.country/);
  });
});

describe("parseOpportunities: attendance sessions", () => {
  const session = (start: string, end: string, extra: Record<string, unknown> = {}) => ({ start, end, label: "Hacking", mandatory: true, ...extra });

  it("is optional, so existing data stays valid", () => {
    expect(parseOne(makeOpportunity())[0].attendanceSessions).toBeUndefined();
  });

  it("accepts sessions inside the event", () => {
    const opp = makeOpportunity({
      attendanceSessions: [
        session("2026-11-14T09:00:00-05:00", "2026-11-14T12:00:00-05:00"),
        session("2026-11-14T13:00:00-05:00", "2026-11-14T17:00:00-05:00", { label: null, mandatory: null }),
      ],
    });
    expect(parseOne(opp)[0].attendanceSessions).toHaveLength(2);
  });

  it.each<[string, unknown, RegExp]>([
    ["not a list", { start: "x" }, /must be a list/],
    ["bad date", [session("2026-11-14", "2026-11-14T12:00:00-05:00")], /valid start and end/],
    ["ends before it starts", [session("2026-11-14T12:00:00-05:00", "2026-11-14T09:00:00-05:00")], /end after it starts/],
    ["outside the event", [session("2026-11-14T08:00:00-05:00", "2026-11-14T12:00:00-05:00")], /within the event/],
    ["bad mandatory", [session("2026-11-14T09:00:00-05:00", "2026-11-14T12:00:00-05:00", { mandatory: "yes" })], /mandatory/],
    ["empty label", [session("2026-11-14T09:00:00-05:00", "2026-11-14T12:00:00-05:00", { label: " " })], /label/],
  ])("rejects %s", (_name, attendanceSessions, message) => {
    expect(() => parseOne({ ...makeOpportunity(), attendanceSessions })).toThrow(message);
  });

  it("real listings need evidence for a session schedule", () => {
    const src = "https://maple.example";
    const opp = makeOpportunity({
      registrationFee: null,
      travelCostEstimate: null,
      applicationDeadline: null,
      eligibility: { studentStatusRequired: null, universities: null, programs: null, years: null, experienceLevels: null, otherRequirements: null },
      evidence: { start: { quote: "Nov 14, 2026 9am", sourceUrl: src }, end: { quote: "Nov 14, 2026 5pm", sourceUrl: src } },
      attendanceSessions: [session("2026-11-14T09:00:00-05:00", "2026-11-14T12:00:00-05:00")],
    });
    expect(() => parseOne(opp, true)).toThrow(/missing evidence for attendanceSessions/);
  });
});
