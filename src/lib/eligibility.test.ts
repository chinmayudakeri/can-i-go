import { describe, expect, it } from "vitest";
import { checkEligibility } from "./eligibility";
import { makeOpportunity, makeProfile } from "./testFixtures";
import type { EligibilityRequirements } from "./types";

const withRequirements = (req: Partial<EligibilityRequirements>) =>
  makeOpportunity({ eligibility: { ...makeOpportunity().eligibility, ...req } });

const check = (result: ReturnType<typeof checkEligibility>, field: keyof EligibilityRequirements) =>
  result.checks.find((c) => c.field === field)!;

describe("checkEligibility", () => {
  it("matches when every requirement is open and the profile is complete", () => {
    const result = checkEligibility(makeOpportunity(), makeProfile());
    expect(result.status).toBe("matches");
    expect(result.checks.every((c) => c.status === "matches")).toBe(true);
  });

  it("marks unknown requirements as needs confirmation, never as a match", () => {
    const opp = withRequirements({
      studentStatusRequired: null,
      universities: null,
      programs: null,
      years: null,
      experienceLevels: null,
    });
    const result = checkEligibility(opp, makeProfile());
    expect(result.status).toBe("needs-confirmation");
    for (const c of result.checks) {
      expect(c.status).toBe("needs-confirmation");
      expect(c.requirement).toBe("Not stated by the source");
    }
  });

  it("does not match when the profile value is outside an explicit list", () => {
    const result = checkEligibility(withRequirements({ universities: ["Northbridge University"] }), makeProfile());
    expect(result.status).toBe("does-not-match");
    expect(check(result, "universities").status).toBe("does-not-match");
    expect(check(result, "universities").requirement).toBe("Northbridge University");
  });

  it("matches programs exactly against the dropdown values", () => {
    const opp = withRequirements({ programs: ["Mechanical Engineering", "Computer Science"] });
    expect(check(checkEligibility(opp, makeProfile({ program: "Mechanical Engineering" })), "programs").status).toBe(
      "matches",
    );
    const other = check(checkEligibility(opp, makeProfile({ program: "Civil Engineering" })), "programs");
    expect(other.status).toBe("does-not-match");
    expect(other.explanation).not.toMatch(/naming difference/);
  });

  it("needs confirmation when the program is Other and the list is restricted", () => {
    const opp = withRequirements({ programs: ["Computer Science"] });
    const c = check(checkEligibility(opp, makeProfile({ program: "Other" })), "programs");
    expect(c.status).toBe("needs-confirmation");
    expect(c.explanation).toMatch(/can't be checked/);
  });

  it("accepts Other when programs are open to all", () => {
    const opp = withRequirements({ programs: "any" });
    expect(check(checkEligibility(opp, makeProfile({ program: "Other" })), "programs").status).toBe("matches");
  });

  it("asks for a program when none is picked", () => {
    const opp = withRequirements({ programs: ["Computer Science"] });
    const c = check(checkEligibility(opp, makeProfile({ program: null })), "programs");
    expect(c.status).toBe("needs-confirmation");
    expect(c.explanation).toMatch(/add your program/i);
  });

  it("still suggests confirming university mismatches, since that field is free text", () => {
    const opp = withRequirements({ universities: ["University of Waterloo"] });
    const c = check(checkEligibility(opp, makeProfile({ university: "UWaterloo" })), "universities");
    expect(c.status).toBe("does-not-match");
    expect(c.explanation).toMatch(/naming difference/);
  });

  it("checks year of study against the accepted list", () => {
    const opp = withRequirements({ years: ["3", "4", "graduate"] });
    expect(checkEligibility(opp, makeProfile({ year: "2" })).status).toBe("does-not-match");
    expect(checkEligibility(opp, makeProfile({ year: "graduate" })).status).toBe("matches");
  });

  it("asks for the missing profile field instead of guessing", () => {
    const opp = withRequirements({ years: ["graduate"] });
    const c = check(checkEligibility(opp, makeProfile({ year: null })), "years");
    expect(c.status).toBe("needs-confirmation");
    expect(c.explanation).toMatch(/add your year of study/i);
  });

  it("needs confirmation for every restricted check when there is no profile", () => {
    const opp = withRequirements({ universities: ["X"], years: ["1"] });
    const result = checkEligibility(opp, null);
    expect(result.status).toBe("needs-confirmation");
    expect(check(result, "universities").status).toBe("needs-confirmation");
    expect(check(result, "studentStatusRequired").status).toBe("needs-confirmation");
  });

  it("treats free-text requirements as needs confirmation", () => {
    const opp = withRequirements({ otherRequirements: ["Must be 18 or older."] });
    const result = checkEligibility(opp, makeProfile());
    expect(result.status).toBe("needs-confirmation");
    expect(result.checks.at(-1)).toMatchObject({ field: "otherRequirements", requirement: "Must be 18 or older." });
  });

  it("lets a hard mismatch outrank an unknown", () => {
    const opp = withRequirements({ programs: null, universities: ["Elsewhere"] });
    expect(checkEligibility(opp, makeProfile()).status).toBe("does-not-match");
  });

  it("matches non-student events without needing a university", () => {
    const opp = withRequirements({ studentStatusRequired: false });
    expect(check(checkEligibility(opp, makeProfile({ university: "" })), "studentStatusRequired").status).toBe(
      "matches",
    );
  });

  it("attaches the source evidence to each check", () => {
    const evidence = { quote: "Northbridge students only.", sourceUrl: "https://example.org/x" };
    const opp = makeOpportunity({
      eligibility: { ...makeOpportunity().eligibility, universities: ["Northbridge University"] },
      evidence: { "eligibility.universities": evidence },
    });
    expect(check(checkEligibility(opp, makeProfile()), "universities").evidence).toEqual(evidence);
  });
});
