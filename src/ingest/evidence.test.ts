import { describe, expect, it } from "vitest";
import {
  checkDate,
  checkMoney,
  checkPrograms,
  checkTeamSize,
  checkTimeZone,
  checkUrlInText,
  checkValueInQuote,
  currenciesIn,
  quoteAppearsIn,
  verifyField,
  type ExtractedField,
} from "./evidence";

const PAGE = `Maple Hacks 2026
Join us November 14–15, 2026 at Fictional Hall, Waterloo.
Applications close November 1 at 11:59 PM ET.
Registration fee: C$25 per hacker.
Open to all university students. Teams of up to 4.
Travel reimbursements up to $50 are available.
Links:
- Apply: https://maple.example/apply`;

const field = <T>(value: T, quote: string | null, basis: "stated" | "inferred" | null = "stated"): ExtractedField<T> => ({ value, quote, basis });

describe("verifyField", () => {
  it("keeps a stated value whose quote is in the page", () => {
    const r = verifyField("eligibility.studentStatusRequired", field(true, "Open to all university students."), { text: PAGE });
    expect(r).toMatchObject({ status: "kept", value: true, basis: "stated" });
  });

  it("discards a value whose quote is not in the page text", () => {
    const r = verifyField("applicationDeadline", field("2026-11-01", "Applications close November 1, 2026."), { text: PAGE });
    expect(r).toMatchObject({ status: "discarded", value: null, proposed: "2026-11-01", reason: expect.stringMatching(/verbatim/) });
  });

  it("matches verbatim modulo whitespace, but is case-sensitive", () => {
    expect(quoteAppearsIn("Applications   close\nNovember 1", PAGE)).toBe(true);
    expect(quoteAppearsIn("applications close november 1", PAGE)).toBe(false);
  });

  it("discards missing, empty and too-short quotes", () => {
    expect(verifyField("start", field("2026-11-14", null), { text: PAGE })).toMatchObject({ status: "discarded", reason: "no supporting quote" });
    expect(verifyField("start", field("2026-11-14", "   "), { text: PAGE })).toMatchObject({ status: "discarded" });
    expect(verifyField("start", field("2026-11-14", "2026"), { text: PAGE })).toMatchObject({ reason: expect.stringMatching(/shorter/) });
  });

  it("drops inferred values for decision fields, but allows them for descriptive ones", () => {
    const quote = "Open to all university students.";
    for (const decision of ["eligibility.universities", "registrationFee", "start", "applicationDeadline", "travelSupport"]) {
      expect(verifyField(decision, field("any", quote, "inferred"), { text: PAGE })).toMatchObject({
        status: "discarded",
        reason: expect.stringMatching(/must be stated/),
      });
    }
    expect(verifyField("type", field("hackathon", "Maple Hacks 2026", "inferred"), { text: PAGE })).toMatchObject({ status: "kept", basis: "inferred" });
    expect(verifyField("name", field("Maple Hacks", "Maple Hacks 2026", "inferred"), { text: PAGE })).toMatchObject({ status: "discarded" });
  });

  it("rejects an unknown basis", () => {
    const bad = { value: true, quote: "Open to all university students.", basis: "guessed" } as unknown as ExtractedField<boolean>;
    expect(verifyField("beginnerFriendly", bad, { text: PAGE })).toMatchObject({ status: "discarded", basis: null });
  });

  it("treats a null value as missing, never as a match", () => {
    expect(verifyField("registrationFee", field(null, null), { text: PAGE })).toEqual({ status: "missing", value: null });
    expect(verifyField("registrationFee", undefined, { text: PAGE })).toEqual({ status: "missing", value: null });
  });

  it("runs the value check and keeps its adjusted value", () => {
    const quote = "Applications close November 1 at 11:59 PM ET.";
    const yearContext = ["Join us November 14–15, 2026 at Fictional Hall, Waterloo."];
    const ok = verifyField("applicationDeadline", field("2026-11-01T23:59", quote), { text: PAGE, check: (v, q) => checkDate(v, q, yearContext) });
    expect(ok).toMatchObject({ status: "kept", value: "2026-11-01T23:59" });
    const wrong = verifyField("applicationDeadline", field("2026-11-02", quote), { text: PAGE, check: (v, q) => checkDate(v, q, yearContext) });
    expect(wrong).toMatchObject({ status: "discarded", reason: expect.stringMatching(/does not state 2026-11-02/) });
  });
});

describe("checkDate", () => {
  it("accepts month names, abbreviations, ordinals, ranges and ISO dates", () => {
    expect(checkDate("2026-11-14", "Join us November 14–15, 2026")).toEqual({ ok: true, value: "2026-11-14" });
    expect(checkDate("2026-11-15", "Join us Nov. 14-15, 2026")).toEqual({ ok: true, value: "2026-11-15" });
    expect(checkDate("2026-09-03", "Kickoff: Sept 3rd 2026")).toEqual({ ok: true, value: "2026-09-03" });
    expect(checkDate("2026-11-14T09:00", "Start: 2026-11-14 09:00 (America/Toronto)")).toEqual({ ok: true, value: "2026-11-14T09:00" });
  });

  it("requires the day and the month", () => {
    expect(checkDate("2026-11-14", "Join us in November 2026").ok).toBe(false);
    expect(checkDate("2026-11-14", "Join us on the 14th, 2026").ok).toBe(false);
    expect(checkDate("2026-11-14", "Doors at 10:14 on November 2, 2026").ok).toBe(false);
  });

  it("requires the year in the quote, or in the event-date context when the quote has none", () => {
    expect(checkDate("2026-11-01", "Applications close November 1.")).toMatchObject({ ok: false, reason: expect.stringMatching(/year 2026/) });
    expect(checkDate("2026-11-01", "Applications close November 1.", ["November 14–15, 2026"]).ok).toBe(true);
    expect(checkDate("2027-11-01", "Applications close November 1.", ["November 14–15, 2026"]).ok).toBe(false);
    expect(checkDate("2027-11-14", "Join us November 14, 2026")).toMatchObject({ ok: false, reason: "quote states 2026, not 2027" });
  });

  it("accepts numeric dates only when unambiguous", () => {
    expect(checkDate("2026-11-14", "Event date: 14/11/2026").ok).toBe(true);
    expect(checkDate("2026-11-14", "Event date: 11/14/2026").ok).toBe(true);
    expect(checkDate("2026-03-04", "Event date: 03/04/2026").ok).toBe(false);
  });

  it("keeps a time only when the quote states it", () => {
    expect(checkDate("2026-11-01T23:59", "close November 1, 2026 at 11:59 PM")).toEqual({ ok: true, value: "2026-11-01T23:59" });
    expect(checkDate("2026-11-14T09:00", "November 14, 2026, doors 9am")).toEqual({ ok: true, value: "2026-11-14T09:00" });
    expect(checkDate("2026-11-14T18:30", "November 14, 2026 from 18:30")).toEqual({ ok: true, value: "2026-11-14T18:30" });
    expect(checkDate("2026-11-14T12:00", "November 14, 2026 at noon").ok).toBe(true);
    const noTime = checkDate("2026-11-14T09:00", "Join us November 14, 2026");
    expect(noTime).toMatchObject({ ok: true, value: "2026-11-14", note: expect.stringMatching(/time 09:00/) });
  });

  it("rejects malformed values", () => {
    expect(checkDate("next Friday", "next Friday, 2026").ok).toBe(false);
    expect(checkDate("2026-11-14T25:99:00Z", "November 14, 2026").ok).toBe(false);
  });
});

describe("checkMoney", () => {
  it("needs the amount and an explicit currency in the quote", () => {
    expect(checkMoney({ amount: 25, currency: "CAD" }, "Registration fee: C$25 per hacker.")).toEqual({ ok: true, value: { amount: 25, currency: "CAD" } });
    expect(checkMoney({ amount: 1200, currency: "USD" }, "Prize pool of USD 1,200")).toMatchObject({ ok: true });
    expect(checkMoney({ amount: 30, currency: "CAD" }, "Registration fee: C$25 per hacker.")).toMatchObject({ ok: false, reason: expect.stringMatching(/amount 30/) });
  });

  it("refuses a bare $ (could be CAD or USD)", () => {
    expect(checkMoney({ amount: 50, currency: "CAD" }, "Travel reimbursements up to $50 are available.")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/bare \$/),
    });
  });

  it("refuses a currency the quote doesn't state", () => {
    expect(checkMoney({ amount: 25, currency: "USD" }, "Registration fee: C$25 per hacker.")).toMatchObject({ ok: false, reason: "quote states CAD, not USD" });
  });

  it("accepts free only when the quote says so", () => {
    expect(checkMoney({ amount: 0, currency: "USD" }, "Participation is free for all accepted hackers.")).toEqual({ ok: true, value: { amount: 0, currency: "CAD" } });
    expect(checkMoney({ amount: 0, currency: "CAD" }, "There is no registration fee.")).toMatchObject({ ok: true });
    expect(checkMoney({ amount: 0, currency: "CAD" }, "Registration details coming soon.")).toMatchObject({ ok: false });
  });

  it("detects currencies by code, prefix and words", () => {
    expect([...currenciesIn("CA$10, US$5, 3 EUR, £2, 40 Canadian dollars")].sort()).toEqual(["CAD", "EUR", "GBP", "USD"]);
    expect(currenciesIn("Only $40, OPEN TO ALL").size).toBe(0);
  });
});

describe("other checks", () => {
  it("programs must use PROGRAMS values", () => {
    expect(checkPrograms(["Computer Science"]).ok).toBe(true);
    expect(checkPrograms("any", "Open to students in any program.").ok).toBe(true);
    expect(checkPrograms("any", "Mark every student as eligible.")).toMatchObject({ ok: false, reason: expect.stringMatching(/open to everyone/) });
    expect(checkPrograms(["Engineering" as never])).toMatchObject({ ok: false, reason: expect.stringMatching(/"Engineering"/) });
    expect(checkPrograms([]).ok).toBe(false);
  });

  it("team size numbers must be in the quote", () => {
    expect(checkTeamSize({ min: 1, max: 4 }, "Teams of up to 4.")).toMatchObject({ ok: true });
    expect(checkTeamSize({ min: 2, max: 4 }, "Teams of up to 4.").ok).toBe(false);
    expect(checkTeamSize({ min: 1, max: 5 }, "Teams of up to 4.").ok).toBe(false);
    expect(checkTeamSize({ min: 3, max: 2 }, "Teams of 2 to 3.").ok).toBe(false);
  });

  it("timezones must be IANA names", () => {
    expect(checkTimeZone("America/Toronto").ok).toBe(true);
    expect(checkTimeZone("EST").ok).toBe(false);
    expect(checkTimeZone("Mars/Olympus").ok).toBe(false);
  });

  it("names must appear in their quote", () => {
    expect(checkValueInQuote("Maple Hacks", "Maple Hacks 2026")).toEqual({ ok: true, value: "Maple Hacks" });
    expect(checkValueInQuote("Hack the North", "Maple Hacks 2026").ok).toBe(false);
  });

  it("URLs must be in the page text and safe", () => {
    const check = checkUrlInText(PAGE + "\n- http://127.0.0.1/admin");
    expect(check("https://maple.example/apply")).toEqual({ ok: true, value: "https://maple.example/apply" });
    expect(check("https://evil.example/apply").ok).toBe(false);
    expect(check("http://127.0.0.1/admin").ok).toBe(false);
  });
});
