import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, buildFeedItem, filterFeed, getFeed, getFilterOptions, sortFeed, type FeedFilters } from "./feed";
import { NOW, makeOpportunity, makeProfile } from "./testFixtures";
import type { Opportunity } from "./types";

const cad = (amount: number) => ({ amount, currency: "CAD" });

const OPPS: Opportunity[] = [
  makeOpportunity({
    id: "open-soon",
    name: "Alpha Hack",
    applicationDeadline: "2026-10-20T23:59:00-04:00",
    start: "2026-12-01T09:00:00-05:00",
    end: "2026-12-01T17:00:00-05:00",
    tags: ["AI"],
  }),
  makeOpportunity({
    id: "passed",
    name: "Bravo Workshop",
    type: "workshop",
    applicationDeadline: "2026-10-01T23:59:00-04:00",
    start: "2026-10-25T09:00:00-04:00",
    end: "2026-10-25T17:00:00-04:00",
    tags: ["Robotics"],
    beginnerFriendly: false,
  }),
  makeOpportunity({
    id: "online-unknown-deadline",
    name: "Charlie Online",
    format: "online",
    location: null,
    applicationDeadline: null,
    start: "2026-11-05T09:00:00-05:00",
    end: "2026-11-05T17:00:00-05:00",
    tags: ["Web"],
    registrationFee: cad(0),
    travelCostEstimate: null,
  }),
  makeOpportunity({
    id: "restricted-unknown-cost",
    name: "Delta Conference",
    type: "conference",
    location: { venue: null, city: "Toronto", region: "ON", country: "Canada" },
    applicationDeadline: "2026-11-15T23:59:00-05:00",
    start: "2026-11-20T09:00:00-05:00",
    end: "2026-11-20T17:00:00-05:00",
    registrationFee: null,
    beginnerFriendly: null,
    eligibility: { ...makeOpportunity().eligibility, universities: ["Elsewhere University"] },
    tags: ["Security"],
  }),
  makeOpportunity({
    id: "unknown-eligibility",
    name: "Echo Meetup",
    type: "meetup",
    applicationDeadline: "2026-11-10T23:59:00-05:00",
    start: "2026-11-12T18:00:00-05:00",
    end: "2026-11-12T20:00:00-05:00",
    registrationFee: cad(100),
    travelCostEstimate: cad(0),
    eligibility: { ...makeOpportunity().eligibility, programs: null },
    tags: ["AI", "Web"],
  }),
];

const profile = makeProfile();
const items = OPPS.map((o) => buildFeedItem(o, profile, NOW));
const ids = (xs: { opportunity: Opportunity }[]) => xs.map((x) => x.opportunity.id);
const filter = (f: Partial<FeedFilters>) => ids(filterFeed(items, { ...DEFAULT_FILTERS, ...f }));

describe("filterFeed", () => {
  it("hides passed deadlines by default", () => {
    expect(filter({})).not.toContain("passed");
    expect(filter({ deadline: "only-passed" })).toEqual(["passed"]);
    expect(filter({ deadline: "all" })).toHaveLength(OPPS.length);
  });

  it("keeps unknown deadlines when hiding passed ones", () => {
    expect(filter({})).toContain("online-unknown-deadline");
  });

  it("searches across name, organizer, tags and city", () => {
    expect(filter({ query: "delta" })).toEqual(["restricted-unknown-cost"]);
    expect(filter({ query: "toronto" })).toEqual(["restricted-unknown-cost"]);
    expect(filter({ query: "web echo" })).toEqual(["unknown-eligibility"]);
    expect(filter({ query: "nothing-matches-this" })).toEqual([]);
  });

  it("filters by type and topic", () => {
    expect(filter({ types: ["conference", "meetup"] })).toEqual(["restricted-unknown-cost", "unknown-eligibility"]);
    expect(filter({ topic: "Web" })).toEqual(["online-unknown-deadline", "unknown-eligibility"]);
  });

  it("filters by online, in person, and city", () => {
    expect(filter({ location: "online" })).toEqual(["online-unknown-deadline"]);
    expect(filter({ location: "in-person" })).not.toContain("online-unknown-deadline");
    expect(filter({ location: "city:Toronto" })).toEqual(["restricted-unknown-cost"]);
  });

  it("treats unknown beginner-friendliness as not beginner friendly", () => {
    expect(filter({ beginnerFriendlyOnly: true, deadline: "all" })).not.toContain("restricted-unknown-cost");
    expect(filter({ beginnerFriendlyOnly: true, deadline: "all" })).not.toContain("passed");
  });

  it("filters by eligibility status", () => {
    expect(filter({ eligibility: "does-not-match" })).toEqual(["restricted-unknown-cost"]);
    expect(filter({ eligibility: "needs-confirmation" })).toEqual(["unknown-eligibility"]);
    expect(filter({ eligibility: "matches" })).toEqual(["open-soon", "online-unknown-deadline"]);
  });
});

describe("sortFeed", () => {
  it("sorts by deadline: open soonest first, then unknown, then passed", () => {
    expect(ids(sortFeed(items, "deadline"))).toEqual([
      "open-soon",
      "unknown-eligibility",
      "restricted-unknown-cost",
      "online-unknown-deadline",
      "passed",
    ]);
  });

  it("sorts by event start date", () => {
    expect(ids(sortFeed(items, "start"))).toEqual([
      "passed",
      "online-unknown-deadline",
      "unknown-eligibility",
      "restricted-unknown-cost",
      "open-soon",
    ]);
  });

  it("sorts by cost: fully known cheapest first, then partial, then unknown", () => {
    // open-soon & passed: $30 complete; unknown-eligibility: $100 complete;
    // online-unknown-deadline: $0 complete (online → no travel);
    // restricted-unknown-cost: $20 known, fee missing.
    expect(ids(sortFeed(items, "cost"))).toEqual([
      "online-unknown-deadline",
      "open-soon",
      "passed",
      "unknown-eligibility",
      "restricted-unknown-cost",
    ]);
  });

  it("sorts by relevance using visible reasons for minus against", () => {
    const sorted = sortFeed(items, "relevance");
    const net = sorted.map((i) => [i.opportunity.id, i.relevance.forCount - i.relevance.againstCount]);
    expect(net).toEqual([
      ["open-soon", 4], // interest, beginner, same city, fits budget
      ["unknown-eligibility", 4], // same, $100 fits exactly; tie broken by later deadline
      ["online-unknown-deadline", 3], // beginner, online, fits budget ($0)
      ["passed", 1], // same city + budget, minus not beginner friendly
      ["restricted-unknown-cost", 0], // other city, beginner support & cost unknown: all neutral
    ]);
  });

  it("does not mutate its input", () => {
    const before = ids(items);
    sortFeed(items, "cost");
    expect(ids(items)).toEqual(before);
  });
});

describe("getFeed", () => {
  it("applies filters then sort", () => {
    expect(ids(getFeed(OPPS, profile, { ...DEFAULT_FILTERS, topic: "AI" }, "start", NOW))).toEqual([
      "unknown-eligibility",
      "open-soon",
    ]);
  });

  it("works with no profile", () => {
    const feed = getFeed(OPPS, null, DEFAULT_FILTERS, "relevance", NOW);
    expect(feed).toHaveLength(4);
    expect(feed.every((i) => i.eligibility.status !== "matches")).toBe(true);
  });
});

describe("getFilterOptions", () => {
  it("derives options from the data, excluding online events from cities", () => {
    const opts = getFilterOptions(OPPS);
    expect(opts.cities).toEqual(["Toronto", "Waterloo"]);
    expect(opts.topics).toEqual(["AI", "Robotics", "Security", "Web"]);
    expect(opts.types).toEqual(["conference", "hackathon", "meetup", "workshop"]);
  });
});
