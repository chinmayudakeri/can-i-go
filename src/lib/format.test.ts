import { describe, expect, it } from "vitest";
import { formatPlace } from "./format";
import { explainRelevance } from "./relevance";
import { summarizeCosts } from "./costs";
import { makeOpportunity, makeProfile } from "./testFixtures";

describe("formatPlace (cards)", () => {
  it("shows city and region when the country is stated", () => {
    expect(formatPlace(makeOpportunity())).toBe("Waterloo, ON");
  });

  it('says "country not stated" instead of guessing one', () => {
    const o = makeOpportunity({ location: { venue: null, city: "Waterloo", region: "ON", country: null } });
    expect(formatPlace(o)).toBe("Waterloo, ON (country not stated)");
  });

  it("falls back to the venue when there's no city", () => {
    const o = makeOpportunity({ format: "hybrid", location: { venue: "Fictional Hall", city: null, region: null, country: null } });
    expect(formatPlace(o)).toBe("Fictional Hall (country not stated) or online");
  });

  it("travel reasons don't assume a city that isn't stated", () => {
    const o = makeOpportunity({ location: { venue: "Fictional Hall", city: null, region: null, country: null } });
    const reasons = explainRelevance(o, makeProfile(), summarizeCosts(o)).reasons.map((r) => r.text);
    expect(reasons).toContain("City not stated, so travel can't be compared");
  });
});
