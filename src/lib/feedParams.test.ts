import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type FeedFilters } from "./feed";
import { DEFAULT_SORT, parseFeedParams, toFeedParams } from "./feedParams";

describe("feed URL params", () => {
  it("uses defaults for an empty URL and writes nothing for defaults", () => {
    expect(parseFeedParams(new URLSearchParams())).toEqual({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT });
    expect(toFeedParams(DEFAULT_FILTERS, DEFAULT_SORT).toString()).toBe("");
  });

  it("round-trips every filter", () => {
    const filters: FeedFilters = {
      query: "ai hack",
      types: ["hackathon", "workshop"],
      topic: "Web",
      location: "city:Toronto",
      beginnerFriendlyOnly: true,
      eligibility: "needs-confirmation",
      deadline: "all",
    };
    const params = new URLSearchParams(toFeedParams(filters, "cost").toString());
    expect(parseFeedParams(params)).toEqual({ filters, sort: "cost" });
  });

  it("ignores invalid values", () => {
    const parsed = parseFeedParams(new URLSearchParams("sort=random&deadline=whenever&location=moon&eligibility=maybe"));
    expect(parsed).toEqual({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT });
  });
});
