import { describe, expect, it } from "vitest";
import { summarizeCosts } from "./costs";
import { explainRelevance } from "./relevance";
import { makeOpportunity, makeProfile } from "./testFixtures";
import type { Opportunity, StudentProfile } from "./types";

const explain = (opp: Opportunity, profile: StudentProfile | null) =>
  explainRelevance(opp, profile, summarizeCosts(opp));
const reason = (r: ReturnType<typeof explain>, kind: string) => r.reasons.filter((x) => x.kind === kind);

describe("explainRelevance", () => {
  it("asks for a profile when there is none", () => {
    const r = explain(makeOpportunity(), null);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toMatchObject({ kind: "profile", tone: "neutral" });
    expect(r.forCount).toBe(0);
  });

  it("names the shared interests", () => {
    const r = explain(makeOpportunity({ tags: ["AI", "Web"] }), makeProfile({ interests: ["ai", "Robotics"] }));
    expect(reason(r, "interest")[0]).toMatchObject({ tone: "positive", text: "Matches your interests: AI" });
  });

  it("only mentions beginner support for beginners", () => {
    expect(reason(explain(makeOpportunity(), makeProfile()), "beginner")[0].tone).toBe("positive");
    expect(reason(explain(makeOpportunity({ beginnerFriendly: false }), makeProfile()), "beginner")[0].tone).toBe(
      "negative",
    );
    expect(reason(explain(makeOpportunity({ beginnerFriendly: null }), makeProfile()), "beginner")[0].tone).toBe(
      "neutral",
    );
    expect(reason(explain(makeOpportunity(), makeProfile({ experience: "advanced" })), "beginner")).toEqual([]);
  });

  it("says costs fit the budget only when every cost is known", () => {
    expect(reason(explain(makeOpportunity(), makeProfile({ budget: 100 })), "budget")[0].tone).toBe("positive");

    const missing = reason(explain(makeOpportunity({ travelCostEstimate: null }), makeProfile()), "budget")[0];
    expect(missing.tone).toBe("neutral");
    expect(missing.text).toMatch(/travel is unknown/i);
  });

  it("flags known costs over budget, even when other costs are missing", () => {
    const opp = makeOpportunity({ registrationFee: { amount: 500, currency: "CAD" }, travelCostEstimate: null });
    const r = reason(explain(opp, makeProfile({ budget: 100 })), "budget")[0];
    expect(r.tone).toBe("negative");
    expect(r.text).toMatch(/known costs alone/i);
  });

  it("never compares a budget against costs in another currency", () => {
    const opp = makeOpportunity({
      registrationFee: { amount: 10, currency: "USD" },
      travelCostEstimate: { amount: 20, currency: "USD" },
    });
    const r = reason(explain(opp, makeProfile({ budget: 100 })), "budget")[0];
    expect(r).toMatchObject({ tone: "neutral", text: "Can't compare costs to your budget yet" });
  });

  it("shows budget amounts in CAD", () => {
    expect(reason(explain(makeOpportunity(), makeProfile({ budget: 100 })), "budget")[0].text).toBe(
      "Costs ($30) fit your $100 budget",
    );
  });

  it("skips the budget reason when no budget is set", () => {
    expect(reason(explain(makeOpportunity(), makeProfile({ budget: null })), "budget")).toEqual([]);
  });

  it("recognises events in the starting city", () => {
    expect(reason(explain(makeOpportunity(), makeProfile()), "travel")[0].tone).toBe("positive");
  });

  it("does not invent a travel time for other cities", () => {
    const r = reason(explain(makeOpportunity(), makeProfile({ startingLocation: "Kingston, ON" })), "travel")[0];
    expect(r.tone).toBe("neutral");
    expect(r.text).toMatch(/not estimated yet/);
  });

  it("penalises a format the student doesn't want", () => {
    const r = explain(makeOpportunity(), makeProfile({ formatPreference: "online" }));
    expect(reason(r, "format")[0].tone).toBe("negative");
    expect(r.againstCount).toBeGreaterThan(0);
  });

  it("counts online events as no travel", () => {
    const opp = makeOpportunity({ format: "online", location: null });
    expect(reason(explain(opp, makeProfile()), "travel")[0]).toMatchObject({ tone: "positive" });
  });
});
