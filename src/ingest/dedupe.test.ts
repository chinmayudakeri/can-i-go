import { describe, expect, it } from "vitest";
import { makeOpportunity } from "@/lib/testFixtures";
import { dedupeKey, dedupeListings, listingId, localStartDate, mergeOpportunities, normalizeName, upsertListing } from "./dedupe";

const real = (overrides: Parameters<typeof makeOpportunity>[0] = {}) =>
  makeOpportunity({ id: "real-maple-hacks-2026-11-14", name: "Maple Hacks 2026", ...overrides });

describe("normalizeName", () => {
  it("ignores case, accents, punctuation and years", () => {
    expect(normalizeName("Maple Hacks 2026!")).toBe("maple hacks");
    expect(normalizeName("  MAPLE   hacks ")).toBe("maple hacks");
    expect(normalizeName("Hack'n Québec — 2027")).toBe("hackn quebec");
    expect(normalizeName("Team 404 Hacks")).toBe("team 404 hacks");
  });
});

describe("dedupe keys and ids", () => {
  it("uses the start date in the event's own timezone", () => {
    const late = { start: "2026-11-14T23:30:00Z", timezone: "Etc/UTC" };
    expect(localStartDate(late)).toBe("2026-11-14");
    expect(localStartDate({ ...late, timezone: "Asia/Tokyo" })).toBe("2026-11-15");
  });

  it("treats the same name on the same date as one event", () => {
    expect(dedupeKey(real())).toBe(dedupeKey(real({ name: "MAPLE HACKS" })));
    expect(dedupeKey(real())).not.toBe(dedupeKey(real({ start: "2027-11-14T09:00:00-05:00", end: "2027-11-14T17:00:00-05:00" })));
  });

  it("builds real- ids", () => {
    expect(listingId(real())).toBe("real-maple-hacks-2026-11-14");
  });
});

describe("mergeOpportunities", () => {
  const older = real({ sourceUrl: "https://a.example/maple", lastVerified: "2026-10-01", registrationFee: { amount: 10, currency: "CAD" } });
  const newer = real({ id: "real-other", sourceUrl: "https://b.example/maple", sourceUrls: ["https://c.example/maple"], lastVerified: "2026-10-15", registrationFee: { amount: 15, currency: "CAD" } });

  it("keeps every source URL and the latest verification date", () => {
    const { merged } = mergeOpportunities(older, newer);
    expect(merged.sourceUrls).toEqual(["https://b.example/maple", "https://c.example/maple", "https://a.example/maple"]);
    expect(merged.lastVerified).toBe("2026-10-15");
    expect(merged.id).toBe(older.id);
  });

  it("takes values (and their evidence) from the more recently verified record, whichever side it's on", () => {
    expect(mergeOpportunities(older, newer).merged.registrationFee?.amount).toBe(15);
    const { merged, conflicts } = mergeOpportunities(newer, older);
    expect(merged.registrationFee?.amount).toBe(15);
    expect(merged.lastVerified).toBe("2026-10-15");
    expect(merged.sourceUrl).toBe("https://b.example/maple");
    expect(conflicts).toEqual(["registrationFee"]);
  });
});

describe("upsertListing", () => {
  it("adds new events and merges duplicates", () => {
    const first = upsertListing([], real({ sourceUrl: "https://a.example/maple", lastVerified: "2026-10-01" }));
    expect(first).toMatchObject({ action: "added", id: "real-maple-hacks-2026-11-14" });
    expect(first.listings[0].sourceUrls).toEqual(["https://a.example/maple"]);

    const second = upsertListing(first.listings, real({ name: "Maple Hacks", sourceUrl: "https://b.example/maple", lastVerified: "2026-10-12" }));
    expect(second.action).toBe("updated");
    expect(second.listings).toHaveLength(1);
    expect(second.listings[0].sourceUrls).toEqual(["https://b.example/maple", "https://a.example/maple"]);
    expect(second.listings[0].lastVerified).toBe("2026-10-12");
  });

  it("collapses duplicates within a list", () => {
    const list = dedupeListings([
      real({ sourceUrl: "https://a.example/1" }),
      real({ id: "real-x", name: "maple hacks", sourceUrl: "https://b.example/2" }),
      real({ id: "real-other-event", name: "Other Event" }),
    ]);
    expect(list.map((o) => o.name)).toEqual(["maple hacks", "Other Event"]);
    expect(list[0].sourceUrls).toHaveLength(2);
  });
});
