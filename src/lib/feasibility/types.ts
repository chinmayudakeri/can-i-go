import type { CalendarCoverage, Commitment } from "../calendar/types";
import type { Opportunity } from "../types";

export interface FeasibilityAssumptions {
  /** One-way travel time the student entered for this event, in minutes. `null` = not entered. */
  oneWayTravelMinutes: number | null;
  /** Setting: arrive this many minutes before the first session. */
  arrivalBufferMinutes: number;
  /** Setting: days before an exam the student wants free to prepare. */
  examPrepDays: number;
  /** Setting: warn about assignments due within this many hours of the event. */
  assignmentWarningHours: number;
  /** Hybrid events: how the student plans to attend. */
  hybridAttendance: "in-person" | "online";
  /** The student's IANA timezone, used for explanations and coverage dates. */
  timezone: string;
}

export const DEFAULT_ASSUMPTIONS: FeasibilityAssumptions = {
  oneWayTravelMinutes: null,
  arrivalBufferMinutes: 30,
  examPrepDays: 2,
  assignmentWarningHours: 48,
  hybridAttendance: "in-person",
  timezone: "America/Toronto",
};

export interface ShortlistEntry {
  opportunity: Opportunity;
  /** One-way travel minutes the student entered for this event, or null. */
  oneWayTravelMinutes: number | null;
}

export interface FeasibilityInput {
  opportunity: Opportunity;
  /** Imported calendar events and manual commitments together. */
  commitments: Commitment[];
  coverage: CalendarCoverage[];
  assumptions: FeasibilityAssumptions;
  /** Other events the student shortlisted. The opportunity itself is skipped if present. */
  shortlist?: ShortlistEntry[];
  now: Date;
}

export type FindingCode =
  | "event-ended"
  | "deadline-passed"
  | "deadline-uncertain"
  | "session-conflict"
  | "optional-session-conflict"
  | "travel-outbound"
  | "travel-return"
  | "between-sessions"
  | "exam-prep"
  | "assignment-due"
  | "shortlist-overlap";

export interface Finding {
  code: FindingCode;
  /** Plain language, naming the exact commitment and times. */
  message: string;
  commitmentId: string | null;
  /** For shortlist overlaps: the other opportunity. */
  opportunityId: string | null;
  /** Soft warnings only: worth weighing heavily (exam prep, closed applications), though not a time clash. */
  strong?: boolean;
}

export interface MissingInfo {
  code: "travel-time" | "location" | "event-hours" | "session-mandatory" | "calendar-coverage" | "calendar-unreadable" | "application-deadline";
  message: string;
  /** True when it stops us giving a reliable answer. */
  blocking: boolean;
}

export type FeasibilityStatus = "conflicts" | "calendar coverage incomplete" | "needs confirmation" | "no conflicts found";

export interface TimeWindow {
  /** UTC milliseconds. */
  start: number;
  end: number;
}

export interface AttendanceWindow extends TimeWindow {
  label: string | null;
  mandatory: boolean | null;
}

export type TravelPlan =
  | { status: "not needed" }
  | { status: "needs confirmation"; reason: "location" | "travel-time" }
  | { status: "known"; minutes: number; bufferMinutes: number; outbound: TimeWindow; return: TimeWindow };

export interface AttendancePlan {
  /**
   * "sessions": the published schedule. "event hours": the whole start–end
   * span. "conservative date window": hours aren't published, so every day
   * of the event is treated as fully occupied.
   */
  basis: "sessions" | "event hours" | "conservative date window";
  /** Plain-language description of the basis, to show with the result. */
  basisLabel: string;
  mode: "in-person" | "online";
  /** Sorted by start. */
  windows: AttendanceWindow[];
  /** Breaks between consecutive windows. Not required attendance. */
  gaps: TimeWindow[];
  travel: TravelPlan;
  /** First to last moment this plan occupies, including known travel. */
  span: TimeWindow;
}

export interface FeasibilityResult {
  status: FeasibilityStatus;
  summary: string;
  plan: AttendancePlan;
  hardConflicts: Finding[];
  softWarnings: Finding[];
  missingInformation: MissingInfo[];
  /** Dates (YYYY-MM-DD, student's timezone) the plan touches that no calendar covers. */
  uncoveredDates: string[];
}
