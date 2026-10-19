import type { RawDocument, SourceAdapter } from "./adapters/types";

/** A fictional event page and a well-behaved model response for it. Test-only. */

export const PAGE_URL = "https://maple.example/2026";

export const PAGE = `Maple Hacks 2026
Maple Hacks is a 24-hour student hackathon in Waterloo with workshops for first-time hackers.
Hosted by the Maple Student Tech Club.
When: November 14–15, 2026, starting at 9:00 AM ET and ending at 5:00 PM ET.
Where: Fictional Hall, Waterloo, ON
Applications close November 1 at 11:59 PM ET.
Open to all university students. No experience required.
Teams of up to 4.
Registration fee: none, participation is free.
All meals are provided.
Travel reimbursements up to $50 are available.

Links:
- Apply: https://maple.example/apply`;

type Basis = "stated" | "inferred";
export const f = (value: unknown, quote: string | null, basis: Basis | null = "stated") => ({ value, quote, basis });
const NONE = { value: null, quote: null, basis: null };

export function goodResponse(overrides: Record<string, unknown> = {}, eligibility: Record<string, unknown> = {}) {
  return {
    isEvent: true,
    name: f("Maple Hacks 2026", "Maple Hacks 2026"),
    organizer: f("Maple Student Tech Club", "Hosted by the Maple Student Tech Club."),
    description: f("A student hackathon.", "Maple Hacks is a 24-hour student hackathon in Waterloo with workshops for first-time hackers."),
    type: f("hackathon", "24-hour student hackathon"),
    format: f("in-person", "Where: Fictional Hall, Waterloo, ON", "inferred"),
    location: f({ venue: "Fictional Hall", city: "Waterloo", region: "ON", country: "Canada" }, "Where: Fictional Hall, Waterloo, ON"),
    timezone: f("America/Toronto", "starting at 9:00 AM ET", "inferred"),
    start: f("2026-11-14T09:00", "When: November 14–15, 2026, starting at 9:00 AM ET"),
    end: f("2026-11-15T17:00", "November 14–15, 2026, starting at 9:00 AM ET and ending at 5:00 PM ET."),
    applicationDeadline: f("2026-11-01T23:59", "Applications close November 1 at 11:59 PM ET."),
    officialUrl: NONE,
    applyUrl: f("https://maple.example/apply", "- Apply: https://maple.example/apply"),
    eligibility: {
      studentStatusRequired: f(true, "Open to all university students."),
      universities: f({ openToAll: true, list: [] }, "Open to all university students."),
      programs: NONE,
      years: NONE,
      experienceLevels: f({ openToAll: true, list: [] }, "No experience required."),
      otherRequirements: NONE,
      ...eligibility,
    },
    teamSize: f({ min: 1, max: 4 }, "Teams of up to 4."),
    registrationFee: f({ amount: 0, currency: "CAD" }, "Registration fee: none, participation is free."),
    travelCostEstimate: NONE,
    lodgingSupport: NONE,
    foodSupport: f("full", "All meals are provided."),
    travelSupport: f("partial", "Travel reimbursements up to $50 are available."),
    tags: NONE,
    beginnerFriendly: f(true, "workshops for first-time hackers", "inferred"),
    ...overrides,
  };
}

export function makeDoc(overrides: Partial<RawDocument> = {}): RawDocument {
  return { itemKey: `page:${PAGE_URL}`, sourceUrl: PAGE_URL, fetchedAt: "2026-10-18T16:00:00.000Z", text: PAGE, ...overrides };
}

export function fakeAdapter(docs: RawDocument[] | (() => RawDocument[]), name = "fake"): SourceAdapter {
  return { name, fetchDocuments: async () => (typeof docs === "function" ? docs() : docs) };
}
