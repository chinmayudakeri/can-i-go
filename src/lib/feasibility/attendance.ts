import type { Opportunity } from "../types";
import { localDateOfMs, localTimeOfMs } from "../zonedTime";
import { formatDates } from "./format";
import type { AttendancePlan, AttendanceWindow, FeasibilityAssumptions, TimeWindow, TravelPlan } from "./types";

const MINUTE_MS = 60_000;

/**
 * True when only the event's dates are known. Ingestion stores a date with no
 * stated time as 00:00:00 to 23:59:59 local time, so that pattern means
 * "hours unknown". A published session schedule always counts as known hours.
 */
export function eventHoursUnknown(opp: Opportunity): boolean {
  if (opp.attendanceSessions?.length) return false;
  const start = Date.parse(opp.start);
  const end = Date.parse(opp.end);
  return localTimeOfMs(start, opp.timezone) === "00:00:00" && localTimeOfMs(end, opp.timezone) === "23:59:59";
}

export function attendanceMode(opp: Opportunity, assumptions: Pick<FeasibilityAssumptions, "hybridAttendance">): "in-person" | "online" {
  if (opp.format === "online") return "online";
  if (opp.format === "hybrid") return assumptions.hybridAttendance;
  return "in-person";
}

/** Windows that decide when you must arrive and when you leave: required ones, or all of them if none is required. */
export function requiredSpan(windows: AttendanceWindow[]): TimeWindow {
  const required = windows.filter((w) => w.mandatory !== false);
  const use = required.length ? required : windows;
  return { start: Math.min(...use.map((w) => w.start)), end: Math.max(...use.map((w) => w.end)) };
}

/**
 * When the student would be busy with this event: its sessions (or whole
 * span, or a conservative whole-day window when hours are unknown), the gaps
 * between sessions, and travel there and back.
 */
export function planAttendance(
  opp: Opportunity,
  oneWayTravelMinutes: number | null,
  assumptions: Pick<FeasibilityAssumptions, "arrivalBufferMinutes" | "hybridAttendance">,
): AttendancePlan {
  const mode = attendanceMode(opp, assumptions);
  const start = Date.parse(opp.start);
  const end = Date.parse(opp.end);

  let basis: AttendancePlan["basis"];
  let basisLabel: string;
  let windows: AttendanceWindow[];
  if (opp.attendanceSessions?.length) {
    basis = "sessions";
    basisLabel = "Checked against the published session schedule. Breaks between sessions aren't treated as required.";
    windows = opp.attendanceSessions
      .map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end), label: s.label, mandatory: s.mandatory }))
      .sort((a, b) => a.start - b.start);
  } else if (eventHoursUnknown(opp)) {
    basis = "conservative date window";
    basisLabel = `Event hours aren't published, so we assume it could run all day on ${formatDates(start, end, opp.timezone)} (conservative).`;
    // The stored end is 23:59:59; the window runs to the next midnight.
    windows = [{ start, end: end + 1000, label: null, mandatory: null }];
  } else {
    basis = "event hours";
    basisLabel = "No session schedule is published, so the whole event is treated as required.";
    windows = [{ start, end, label: null, mandatory: null }];
  }

  const gaps: TimeWindow[] = [];
  let reach = windows[0].end;
  for (const w of windows.slice(1)) {
    if (w.start > reach) gaps.push({ start: reach, end: w.start });
    reach = Math.max(reach, w.end);
  }

  let travel: TravelPlan;
  if (mode === "online") travel = { status: "not needed" };
  else if (!opp.location) travel = { status: "needs confirmation", reason: "location" };
  else if (oneWayTravelMinutes === null || !Number.isFinite(oneWayTravelMinutes) || oneWayTravelMinutes < 0) {
    travel = { status: "needs confirmation", reason: "travel-time" };
  } else {
    const span = requiredSpan(windows);
    const buffer = Math.max(0, assumptions.arrivalBufferMinutes);
    travel = {
      status: "known",
      minutes: oneWayTravelMinutes,
      bufferMinutes: buffer,
      outbound: { start: span.start - (oneWayTravelMinutes + buffer) * MINUTE_MS, end: span.start },
      return: { start: span.end, end: span.end + oneWayTravelMinutes * MINUTE_MS },
    };
  }

  const first = Math.min(...windows.map((w) => w.start));
  const last = Math.max(...windows.map((w) => w.end));
  const span =
    travel.status === "known"
      ? { start: Math.min(first, travel.outbound.start), end: Math.max(last, travel.return.end) }
      : { start: first, end: last };

  return { basis, basisLabel, mode, windows, gaps, travel, span };
}

/** Every local date (YYYY-MM-DD) a window touches. An end at exactly midnight doesn't touch the next day. */
export function datesTouched(w: TimeWindow, timeZone: string): { first: string; last: string } {
  return { first: localDateOfMs(w.start, timeZone), last: localDateOfMs(Math.max(w.start, w.end - 1), timeZone) };
}
