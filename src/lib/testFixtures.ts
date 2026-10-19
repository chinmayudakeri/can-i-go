import { EMPTY_PROFILE } from "./profileStorage";
import type { Opportunity, StudentProfile } from "./types";

/** A fully-known, open-to-all, single-day in-person event. Override what each test cares about. */
export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "test-event",
    name: "Test Event",
    organizer: "Test Org",
    type: "hackathon",
    description: "A test event.",
    officialUrl: "https://example.org/test",
    applyUrl: "https://example.org/test/apply",
    format: "in-person",
    location: { venue: null, city: "Waterloo", region: "ON", country: "Canada" },
    timezone: "America/Toronto",
    start: "2026-11-14T09:00:00-05:00",
    end: "2026-11-14T17:00:00-05:00",
    applicationDeadline: "2026-11-01T23:59:00-05:00",
    exactCutoffUnknown: false,
    eligibility: {
      studentStatusRequired: true,
      universities: "any",
      programs: "any",
      years: "any",
      experienceLevels: "any",
      otherRequirements: null,
    },
    teamSize: null,
    registrationFee: { amount: 10, currency: "CAD" },
    travelCostEstimate: { amount: 20, currency: "CAD" },
    lodgingSupport: null,
    foodSupport: null,
    travelSupport: null,
    tags: ["AI"],
    beginnerFriendly: true,
    sourceUrl: "https://example.org/test/details",
    lastVerified: "2026-10-12",
    evidence: {},
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    ...EMPTY_PROFILE,
    university: "Harbor State University",
    program: "Computer Science",
    year: "2",
    interests: ["AI"],
    experience: "beginner",
    startingLocation: "Waterloo, ON",
    maxTravelHours: 2,
    transport: ["transit"],
    budget: 100,
    ...overrides,
  };
}

export const NOW = new Date("2026-10-17T12:00:00-04:00");
