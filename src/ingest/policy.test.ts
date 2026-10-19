import { describe, expect, it } from "vitest";
import { checkSitePolicy, type FetchPurpose } from "./policy";

const check = (url: string, purpose: FetchPurpose = "page") => checkSitePolicy(new URL(url), purpose);

describe("checkSitePolicy", () => {
  it.each(["https://devpost.com/hackathons", "https://hackthenorth2026.devpost.com/", "https://DEVPOST.com./x"])(
    "refuses Devpost (%s), citing its terms",
    (url) => {
      const decision = check(url);
      expect(decision.allowed).toBe(false);
      expect(!decision.allowed && decision.reason).toMatch(/Devpost's terms/);
    },
  );

  it.each(["https://mlh.io/seasons/2027/events", "https://www.mlh.com/events", "https://organize.mlh.io/x.ics"])("refuses MLH (%s)", (url) => {
    expect(check(url, "ics-feed").allowed).toBe(false);
  });

  it("refuses Luma event pages but allows its iCal subscription feeds", () => {
    expect(check("https://lu.ma/some-event").allowed).toBe(false);
    expect(check("https://luma.com/toronto").allowed).toBe(false);
    expect(check("https://api.lu.ma/ics/get?entity=calendar&id=cal-123").allowed).toBe(false); // not as a page
    expect(check("https://api.lu.ma/ics/get?entity=calendar&id=cal-123", "ics-feed")).toEqual({ allowed: true });
    expect(check("https://api.luma.com/ics/get?entity=discover&id=x", "ics-feed")).toEqual({ allowed: true });
    expect(check("https://api.lu.ma/public/v1/calendar", "ics-feed").allowed).toBe(false);
  });

  it("allows other sites (robots.txt is checked separately)", () => {
    expect(check("https://hackthenorth.com/")).toEqual({ allowed: true });
    expect(check("https://notdevpost.com/")).toEqual({ allowed: true });
    expect(check("https://mlh.io.example.org/")).toEqual({ allowed: true });
  });
});
