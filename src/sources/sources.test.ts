import { describe, expect, it } from "vitest";
import { getDeadlineStatus } from "@/lib/deadline";
import { summarizeCosts } from "@/lib/costs";
import { NOW, makeOpportunity } from "@/lib/testFixtures";
import { InvalidOpportunityError, parseOpportunities } from "@/lib/validate";
import type { Opportunity } from "@/lib/types";
import { DemoSource } from "./demoSource";
import { CombinedSource, type OpportunitySource } from "./index";

const fixed = (name: string, opps: Opportunity[]): OpportunitySource => ({
  name,
  getOpportunities: async () => opps,
});

describe("DemoSource", () => {
  it("loads valid, clearly fictional demo events", async () => {
    const opps = await new DemoSource().getOpportunities();
    expect(opps.length).toBeGreaterThanOrEqual(10);
    for (const o of opps) {
      expect(o.name).toMatch(/\(Demo\)/);
      expect(o.organizer).toMatch(/fictional/);
      expect(new URL(o.officialUrl).hostname).toBe("example.org");
      for (const m of [o.registrationFee, o.travelCostEstimate]) if (m) expect(m.currency).toBe("CAD");
    }
  });

  it("covers the edge cases the UI must handle", async () => {
    const opps = await new DemoSource().getOpportunities();
    const kinds = opps.map((o) => getDeadlineStatus(o, NOW).kind);
    expect(kinds).toContain("passed");
    expect(kinds).toContain("unknown");
    expect(kinds).toContain("uncertain");
    expect(opps.some((o) => !summarizeCosts(o).complete)).toBe(true);
    expect(opps.some((o) => o.eligibility.universities === null)).toBe(true);
    expect(opps.some((o) => o.format === "online")).toBe(true);
    expect(opps.some((o) => o.format === "hybrid")).toBe(true);
  });
});

describe("CombinedSource", () => {
  it("merges sources and lets later ones win on duplicate ids", async () => {
    const a = makeOpportunity({ id: "x", name: "Old" });
    const b = makeOpportunity({ id: "x", name: "New" });
    const c = makeOpportunity({ id: "y" });
    const merged = await new CombinedSource([fixed("A", [a]), fixed("B", [b, c])]).getOpportunities();
    expect(merged.map((o) => [o.id, o.name])).toEqual([
      ["x", "New"],
      ["y", "Test Event"],
    ]);
  });

  it("fails loudly if any source fails", async () => {
    const broken: OpportunitySource = { name: "Broken", getOpportunities: () => Promise.reject(new Error("down")) };
    await expect(new CombinedSource([fixed("A", []), broken]).getOpportunities()).rejects.toThrow("down");
  });
});

describe("parseOpportunities", () => {
  it("rejects non-arrays and malformed events with a useful message", () => {
    expect(() => parseOpportunities({}, "Test")).toThrow(InvalidOpportunityError);
    expect(() => parseOpportunities([{ ...makeOpportunity(), start: "nope" }], "Test")).toThrow(/test-event.*start/);
    expect(() => parseOpportunities([makeOpportunity(), makeOpportunity()], "Test")).toThrow(/duplicate id/);
    expect(() => parseOpportunities([{ ...makeOpportunity(), location: null }], "Test")).toThrow(/location/);
    const badProgram = makeOpportunity({ eligibility: { ...makeOpportunity().eligibility, programs: ["Engineering" as never] } });
    expect(() => parseOpportunities([badProgram], "Test")).toThrow(/unknown program.*"Engineering"/);
  });
});
