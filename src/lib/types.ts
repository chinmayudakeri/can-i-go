/**
 * Core domain types.
 *
 * Convention used throughout: `null` means "unknown / not stated by the source".
 * We never guess a value to fill a gap. `"any"` means the source explicitly
 * says the requirement is open to everyone.
 */

export type OpportunityType =
  | "hackathon"
  | "conference"
  | "workshop"
  | "competition"
  | "career-fair"
  | "meetup";

export type EventFormat = "in-person" | "online" | "hybrid";

export type StudyYear = "1" | "2" | "3" | "4" | "5+" | "graduate";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

/**
 * Programs offered in the profile dropdown. Eligibility requirements use the
 * same values, so matching is exact. "Other" can never be verified
 * automatically against a restricted list.
 */
export const PROGRAMS = [
  "Computer Science",
  "Software Engineering",
  "Computer Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Chemical Engineering",
  "Systems Design Engineering",
  "Mathematics",
  "Statistics",
  "Data Science",
  "Physics",
  "Chemistry",
  "Biology",
  "Health Sciences",
  "Kinesiology",
  "Business",
  "Accounting",
  "Finance",
  "Economics",
  "Design",
  "Architecture",
  "Arts and Humanities",
  "Social Sciences",
  "Environment",
  "Other",
] as const;

export type Program = (typeof PROGRAMS)[number];

/** How much of a cost the organizer covers. */
export type SupportLevel = "full" | "partial" | "none";

export interface Money {
  amount: number;
  /** ISO 4217 code, e.g. "CAD". */
  currency: string;
}

/**
 * At least one of `venue` or `city` is known. `country` is null when the
 * source doesn't state it ("Country not stated"); it is never derived.
 */
export interface EventLocation {
  venue: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** Where a fact came from, so the UI can show it next to the claim. */
export interface Evidence {
  /** Short excerpt or paraphrase from the source. Real listings: verbatim from the fetched page. */
  quote: string;
  sourceUrl: string;
  /** Real listings only: whether the source states the value or it was inferred from context. */
  basis?: "stated" | "inferred";
  /** Real listings only, dates: a separate verbatim fragment stating the time of day. */
  timeQuote?: string;
}

/** A list of accepted values, `"any"` (explicitly open), or `null` (unknown). */
export type Requirement<T> = T[] | "any" | null;

export interface TimezoneConfirmation {
  basis: "confirmed by reviewer";
  /** How the reviewer verified it: a short note or a URL (e.g. the venue's official site). */
  note: string;
  /** YYYY-MM-DD. */
  confirmedOn: string;
}

export interface EligibilityRequirements {
  /** Must the applicant be a currently enrolled student? */
  studentStatusRequired: boolean | null;
  universities: Requirement<string>;
  programs: Requirement<Program>;
  years: Requirement<StudyYear>;
  experienceLevels: Requirement<ExperienceLevel>;
  /** Free-text conditions we can't check automatically (always "needs confirmation"). */
  otherRequirements: string[] | null;
}

export type EvidenceField =
  | "start"
  | "end"
  | "applicationDeadline"
  | "location"
  | "registrationFee"
  | "travelCostEstimate"
  | "lodgingSupport"
  | "foodSupport"
  | "travelSupport"
  | "beginnerFriendly"
  | "teamSize"
  | "attendanceSessions"
  | `eligibility.${keyof EligibilityRequirements}`;

/**
 * One block of the event a participant is expected (or invited) to attend,
 * e.g. "Opening ceremony" or "Hacking". `mandatory: null` means the source
 * doesn't say, and feasibility treats it as required.
 */
export interface AttendanceSession {
  /** ISO 8601 with offset, inside the event's start and end. */
  start: string;
  end: string;
  label: string | null;
  mandatory: boolean | null;
}

export interface Opportunity {
  id: string;
  name: string;
  organizer: string;
  type: OpportunityType;
  description: string;
  officialUrl: string;
  applyUrl: string | null;

  format: EventFormat;
  /** `null` for online-only events. */
  location: EventLocation | null;
  /** IANA timezone, e.g. "America/Toronto". */
  timezone: string;
  /**
   * Real listings only: set when the timezone couldn't be derived from the
   * stated location and a reviewer typed it in `npm run review`. Never set by
   * the AI or the page.
   */
  timezoneConfirmation?: TimezoneConfirmation;
  /** ISO 8601 with offset. */
  start: string;
  end: string;
  /**
   * Optional schedule. Without it, the whole start–end span is treated as
   * required attendance. Gaps between sessions (e.g. overnight) aren't required.
   */
  attendanceSessions?: AttendanceSession[];

  /** ISO 8601 with offset, or `null` if no deadline is published. */
  applicationDeadline: string | null;
  /**
   * The date is known but the exact cutoff time is not. In that case
   * `applicationDeadline` holds the *latest* plausible moment (end of that day
   * in the event's timezone), and we warn that it could close earlier.
   */
  exactCutoffUnknown: boolean;

  eligibility: EligibilityRequirements;

  teamSize: { min: number; max: number } | null;
  /** `null` = unknown. Amount 0 = free. */
  registrationFee: Money | null;
  /** Organizer/source estimate of getting there. `null` = unknown. */
  travelCostEstimate: Money | null;
  lodgingSupport: SupportLevel | null;
  foodSupport: SupportLevel | null;
  travelSupport: SupportLevel | null;

  tags: string[];
  beginnerFriendly: boolean | null;

  sourceUrl: string;
  /**
   * Which dataset this came from. Stamped by the source when it loads data
   * (DemoSource → "demo", RealSource → "real"), never read from stored JSON,
   * so a file can't make demo data look real. Anything not "real" is shown as DEMO.
   */
  dataset?: "demo" | "real";
  /** Real listings only: every page this event was found on, after deduplication (includes `sourceUrl`). */
  sourceUrls?: string[];
  /** ISO 8601 date the details were last checked against the source. */
  lastVerified: string;
  evidence: Partial<Record<EvidenceField, Evidence>>;
}

export type FormatPreference = "online" | "in-person" | "either";

export type Transport = "walk-bike" | "transit" | "car" | "train-bus" | "plane";

export interface StudentProfile {
  university: string;
  program: Program | null;
  year: StudyYear | null;
  interests: string[];
  experience: ExperienceLevel | null;
  startingLocation: string;
  /** Hours, one way. */
  maxTravelHours: number | null;
  transport: Transport[];
  /** Total budget per event, in `budgetCurrency`. */
  budget: number | null;
  budgetCurrency: string;
  formatPreference: FormatPreference;
  /** Attendance assumptions. Usual one-way travel time to an in-person event, in minutes; null = not entered. */
  travelMinutes: number | null;
  /** Minutes to arrive before the first session. */
  arrivalBufferMinutes: number;
  /** Days before an exam to keep free for studying. */
  examPrepDays: number;
}
