import { DEFAULT_ARRIVAL_BUFFER_MINUTES, DEFAULT_EXAM_PREP_DAYS } from "../profileStorage";
import type { StudentProfile } from "../types";
import { isValidTimeZone } from "../validate";
import { DEFAULT_ASSUMPTIONS, type FeasibilityAssumptions } from "./types";

export interface AssumptionsUsed {
  assumptions: FeasibilityAssumptions;
  /** Where the travel time came from, so the UI can say. */
  travelSource: "this event" | "your profile" | "not entered";
}

/**
 * The student's settings as feasibility assumptions. A travel time saved for
 * one shortlisted event wins over the profile default. Nothing is guessed:
 * no travel time entered means travel stays "Needs confirmation".
 */
export function assumptionsFromProfile(profile: StudentProfile | null, eventTravelMinutes: number | null, timezone: string): AssumptionsUsed {
  const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const travel = valid(eventTravelMinutes) ? eventTravelMinutes : valid(profile?.travelMinutes) ? profile.travelMinutes : null;
  return {
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      oneWayTravelMinutes: travel,
      arrivalBufferMinutes: valid(profile?.arrivalBufferMinutes) ? profile.arrivalBufferMinutes : DEFAULT_ARRIVAL_BUFFER_MINUTES,
      examPrepDays: valid(profile?.examPrepDays) ? profile.examPrepDays : DEFAULT_EXAM_PREP_DAYS,
      hybridAttendance: profile?.formatPreference === "online" ? "online" : "in-person",
      timezone: isValidTimeZone(timezone) ? timezone : DEFAULT_ASSUMPTIONS.timezone,
    },
    travelSource: valid(eventTravelMinutes) ? "this event" : valid(profile?.travelMinutes) ? "your profile" : "not entered",
  };
}

/** The browser's IANA timezone, or the Waterloo default when it can't be read. */
export function browserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : DEFAULT_ASSUMPTIONS.timezone;
  } catch {
    return DEFAULT_ASSUMPTIONS.timezone;
  }
}

/** Plain-language lines for "Assumptions used". */
export function describeAssumptions(used: AssumptionsUsed): string[] {
  const a = used.assumptions;
  return [
    a.oneWayTravelMinutes === null
      ? "Travel time: not entered (travel needs confirmation)"
      : `Travel time: ${a.oneWayTravelMinutes} minutes each way (from ${used.travelSource})`,
    `Arrive ${a.arrivalBufferMinutes} minutes before the first session`,
    `Keep ${a.examPrepDays} day${a.examPrepDays === 1 ? "" : "s"} before an exam free to study`,
    `Assignments due within ${a.assignmentWarningHours} hours of the event get a warning`,
    `Hybrid events: assumed you attend ${a.hybridAttendance === "online" ? "online" : "in person"}`,
    `Times shown in ${a.timezone}`,
  ];
}
