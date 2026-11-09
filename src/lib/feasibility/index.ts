import type { CalendarCoverage, DeadlineCommitment, TimedCommitment } from "../calendar/types";
import { getDeadlineStatus } from "../deadline";
import type { Opportunity } from "../types";
import { datesBetween } from "../zonedTime";
import { datesTouched, planAttendance, requiredSpan } from "./attendance";
import { formatDates, formatDuration, formatMoment, formatRange } from "./format";
import type {
  AttendancePlan,
  AttendanceWindow,
  FeasibilityAssumptions,
  FeasibilityInput,
  FeasibilityResult,
  FeasibilityStatus,
  Finding,
  MissingInfo,
  ShortlistEntry,
  TimeWindow,
} from "./types";

/**
 * Deterministic attendance check: can the student be at this event, given
 * their calendar, manual commitments and stated assumptions? No AI, no maps:
 * travel time is whatever the student entered, and unknowns stay unknown.
 */

export * from "./types";
export { eventHoursUnknown, planAttendance } from "./attendance";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Half-open overlap of a commitment with a window, so back-to-back blocks
 * don't conflict. A zero-length commitment counts if it sits inside the
 * window; a zero-length window (e.g. 0 minutes of travel) holds nothing.
 */
function overlaps(c: TimeWindow, w: TimeWindow): boolean {
  if (w.start >= w.end) return false;
  if (c.start === c.end) return c.start >= w.start && c.start < w.end;
  return c.start < w.end && c.end > w.start;
}

const KIND_WORDS: Record<TimedCommitment["kind"], string> = {
  class: "Your class",
  exam: "Your exam",
  work: "Your work shift",
  personal: "Your commitment",
  calendar: "",
};

function describe(c: TimedCommitment, tz: string): string {
  const w = spanOf(c);
  const when = c.allDay ? `${formatDates(w.start, w.end, tz)}, marked busy all day` : formatRange(w.start, w.end, tz);
  const tentative = c.tentative ? ", tentative" : "";
  if (c.kind === "calendar") return `"${c.title}" (${when}${tentative}) from your ${c.calendarName ? `${c.calendarName} ` : ""}calendar`;
  return `${KIND_WORDS[c.kind]} "${c.title}" (${when}${tentative})`;
}

function spanOf(c: TimedCommitment): TimeWindow {
  return { start: Date.parse(c.start), end: Date.parse(c.end) };
}

function sessionName(w: AttendanceWindow): string {
  return w.label ? `"${w.label}"` : "a session";
}

/** Where the student would be, for break warnings. */
function placeOf(opp: Opportunity): string {
  const loc = opp.location;
  return loc?.venue ?? loc?.city ?? "the event";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function checkTimed(
  c: TimedCommitment,
  opp: Opportunity,
  plan: AttendancePlan,
  a: FeasibilityAssumptions,
  hard: Finding[],
  soft: Finding[],
): void {
  if (!c.busy) return; // TRANSP:TRANSPARENT: shown as free in the student's own calendar.
  const tz = a.timezone;
  const cw = spanOf(c);
  const who = capitalize(describe(c, tz));
  const finding = (code: Finding["code"], message: string): Finding => ({ code, message, commitmentId: c.id, opportunityId: null });
  const hardBefore = hard.length;

  for (const w of plan.windows) {
    if (!overlaps(cw, w)) continue;
    const range = formatRange(w.start, w.end, tz);
    if (plan.basis === "conservative date window") {
      hard.push(finding("session-conflict", `${who} falls on ${opp.name}'s dates (${formatDates(w.start, w.end, tz)}). The event's hours aren't published, so we assume it could run all day (conservative).`));
    } else if (plan.basis === "event hours") {
      hard.push(finding("session-conflict", `${who} overlaps ${opp.name} (${range}). No session schedule is published, so the whole event is treated as required.`));
    } else if (w.mandatory === true) {
      hard.push(finding("session-conflict", `${who} overlaps ${sessionName(w)} (${range}), a required session of ${opp.name}.`));
    } else if (w.mandatory === null) {
      hard.push(finding("session-conflict", `${who} overlaps ${sessionName(w)} (${range}) of ${opp.name}. The event doesn't say whether it's optional, so it's treated as required.`));
    } else {
      soft.push(finding("optional-session-conflict", `${who} overlaps the optional session ${sessionName(w)} (${range}) of ${opp.name}. You can still go if you skip it.`));
    }
  }

  if (plan.travel.status === "known" && hard.length === hardBefore) {
    const { minutes, bufferMinutes, outbound } = plan.travel;
    const back = plan.travel.return;
    if (overlaps(cw, outbound)) {
      const buffer = bufferMinutes ? ` plus your ${bufferMinutes}-minute arrival buffer` : "";
      hard.push(
        finding(
          "travel-outbound",
          `${who} overlaps your trip to ${opp.name}: ${minutes} minutes of travel${buffer} means leaving by ${formatMoment(outbound.start, tz)} (travel window ${formatRange(outbound.start, outbound.end, tz)}).`,
        ),
      );
    }
    if (overlaps(cw, back)) {
      hard.push(finding("travel-return", `${who} overlaps your trip home from ${opp.name}: ${minutes} minutes of travel after it ends (${formatRange(back.start, back.end, tz)}).`));
    }
  }

  if (hard.length === hardBefore && plan.mode === "in-person") {
    for (const g of plan.gaps) {
      if (!overlaps(cw, g)) continue;
      soft.push(
        finding(
          "between-sessions",
          `${who} falls in a break between sessions of ${opp.name} (${formatRange(g.start, g.end, tz)}). Breaks aren't required, but you'd be away at ${placeOf(opp)}; check you can get there and back.`,
        ),
      );
    }
  }

  if (c.kind === "exam" && hard.length === hardBefore) {
    const span = requiredSpan(plan.windows);
    const bufferEnd = span.end + a.examPrepDays * DAY_MS;
    if (cw.start >= span.start && cw.start < bufferEnd) {
      const when =
        cw.start < span.end
          ? `falls during ${opp.name} (between sessions)`
          : `is ${formatDuration(cw.start - span.end)} after ${opp.name} ends (${formatMoment(span.end, tz)})`;
      // A strong warning, not a hard conflict: you can attend, but it eats into the prep time you asked for.
      soft.push({ ...finding("exam-prep", `${who} ${when}, inside your ${a.examPrepDays}-day exam preparation buffer.`), strong: true });
    }
  }
}

function checkDeadline(c: DeadlineCommitment, opp: Opportunity, plan: AttendancePlan, a: FeasibilityAssumptions, soft: Finding[]): void {
  const due = Date.parse(c.due);
  const span = requiredSpan(plan.windows);
  const margin = a.assignmentWarningHours * HOUR_MS;
  if (due < span.start - margin || due > span.end + margin) return;
  const relation =
    due < span.start
      ? `${formatDuration(span.start - due)} before ${opp.name} starts`
      : due > span.end
        ? `${formatDuration(due - span.end)} after ${opp.name} ends`
        : `while ${opp.name} is on`;
  soft.push({
    code: "assignment-due",
    message: `Your assignment "${c.title}" is due ${formatMoment(due, a.timezone)}, ${relation}. Plan to finish it early.`,
    commitmentId: c.id,
    opportunityId: null,
  });
}

/** Occupied blocks for shortlist comparison: required or unstated windows, plus known travel. */
function busyBlocks(plan: AttendancePlan): (TimeWindow & { travel: boolean })[] {
  const blocks = plan.windows.filter((w) => w.mandatory !== false).map((w) => ({ start: w.start, end: w.end, travel: false }));
  if (plan.travel.status === "known") blocks.push({ ...plan.travel.outbound, travel: true }, { ...plan.travel.return, travel: true });
  return blocks;
}

function shortlistOverlap(a: Opportunity, aPlan: AttendancePlan, b: Opportunity, bPlan: AttendancePlan, tz: string): string | null {
  for (const x of busyBlocks(aPlan)) {
    for (const y of busyBlocks(bPlan)) {
      if (!overlaps(x, y)) continue;
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      const travel = x.travel || y.travel ? ", including travel" : "";
      return `${a.name} overlaps "${b.name}", which is also on your shortlist (both need ${formatRange(start, end, tz)}${travel}).`;
    }
  }
  return null;
}

/** Every pair of shortlisted events that can't both be attended. */
export function findShortlistConflicts(
  entries: ShortlistEntry[],
  assumptions: FeasibilityAssumptions,
): { a: string; b: string; message: string }[] {
  const plans = entries.map((e) => planAttendance(e.opportunity, e.oneWayTravelMinutes, assumptions));
  const out: { a: string; b: string; message: string }[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const message = shortlistOverlap(entries[i].opportunity, plans[i], entries[j].opportunity, plans[j], assumptions.timezone);
      if (message) out.push({ a: entries[i].opportunity.id, b: entries[j].opportunity.id, message });
    }
  }
  return out;
}

function uncovered(plan: AttendancePlan, coverage: CalendarCoverage[], tz: string): string[] {
  const { first, last } = datesTouched(plan.span, tz);
  return datesBetween(first, last).filter((d) => !coverage.some((c) => c.from !== null && c.until !== null && c.from <= d && d <= c.until));
}

function summarize(status: FeasibilityStatus, hard: Finding[], soft: Finding[], uncoveredDates: string[]): string {
  const warnings = soft.length ? ` Check ${soft.length} warning${soft.length === 1 ? "" : "s"}.` : "";
  switch (status) {
    case "conflicts":
      return `${hard.length} conflict${hard.length === 1 ? "" : "s"} found.${warnings}`;
    case "calendar coverage incomplete":
      return `Calendar coverage incomplete: no imported calendar covers ${uncoveredDates.length === 1 ? uncoveredDates[0] : `${uncoveredDates[0]} to ${uncoveredDates[uncoveredDates.length - 1]}`}, so we can't say you're free.${warnings}`;
    case "needs confirmation":
      return `Needs confirmation: some information is missing (see below).${warnings}`;
    case "no conflicts found":
      return `No conflicts found with your calendar and commitments.${warnings}`;
  }
}

export function checkFeasibility(input: FeasibilityInput): FeasibilityResult {
  const { opportunity: opp, commitments, coverage, assumptions: a, now } = input;
  const tz = a.timezone;
  const plan = planAttendance(opp, a.oneWayTravelMinutes, a);
  const hard: Finding[] = [];
  const soft: Finding[] = [];
  const missing: MissingInfo[] = [];

  if (Date.parse(opp.end) <= now.getTime()) {
    soft.push({ code: "event-ended", message: `${opp.name} has already ended.`, commitmentId: null, opportunityId: null, strong: true });
  }
  const deadline = getDeadlineStatus(opp, now);
  if (deadline.kind === "passed") {
    soft.push({
      code: "deadline-passed",
      message: `Applications for ${opp.name} closed ${formatMoment(deadline.deadline.getTime(), tz)}.`,
      commitmentId: null,
      opportunityId: null,
      strong: true,
    });
  } else if (deadline.kind === "uncertain") {
    soft.push({
      code: "deadline-uncertain",
      message: `Applications for ${opp.name} close on ${formatDates(deadline.deadline.getTime(), deadline.deadline.getTime() + 1, opp.timezone)}, but the exact time isn't published, so it may already be closed.`,
      commitmentId: null,
      opportunityId: null,
    });
  } else if (deadline.kind === "unknown") {
    missing.push({ code: "application-deadline", message: "The application deadline isn't published.", blocking: false });
  }

  for (const c of commitments) {
    if (c.kind === "assignment") checkDeadline(c, opp, plan, a, soft);
    else checkTimed(c, opp, plan, a, hard, soft);
  }

  for (const entry of input.shortlist ?? []) {
    if (entry.opportunity.id === opp.id) continue;
    const message = shortlistOverlap(opp, plan, entry.opportunity, planAttendance(entry.opportunity, entry.oneWayTravelMinutes, a), tz);
    if (message) hard.push({ code: "shortlist-overlap", message, commitmentId: null, opportunityId: entry.opportunity.id });
  }

  if (plan.travel.status === "needs confirmation") {
    missing.push(
      plan.travel.reason === "location"
        ? { code: "location", message: "The event's location isn't known, so travel time needs confirmation.", blocking: true }
        : { code: "travel-time", message: `Enter how long it takes you to get to ${placeOf(opp)} (one way) so we can check travel conflicts.`, blocking: true },
    );
  }
  if (plan.basis === "conservative date window") missing.push({ code: "event-hours", message: plan.basisLabel, blocking: false });
  for (const w of plan.windows) {
    if (plan.basis === "sessions" && w.mandatory === null) {
      missing.push({ code: "session-mandatory", message: `The event doesn't say whether ${sessionName(w)} (${formatRange(w.start, w.end, tz)}) is required, so it's treated as required.`, blocking: false });
    }
  }

  const uncoveredDates = uncovered(plan, coverage, tz);
  if (uncoveredDates.length) {
    missing.push({
      code: "calendar-coverage",
      message: `No imported calendar covers ${uncoveredDates.join(", ")}, so we can't say you're free then. Import a calendar that includes ${uncoveredDates.length === 1 ? "this date" : "these dates"}.`,
      blocking: true,
    });
  }
  const { first, last } = datesTouched(plan.span, tz);
  for (const c of coverage) {
    if (c.unreadableEvents > 0 && c.from !== null && c.until !== null && c.from <= last && first <= c.until) {
      missing.push({
        code: "calendar-unreadable",
        message: `${c.unreadableEvents} event${c.unreadableEvents === 1 ? "" : "s"} in "${c.calendarName}" couldn't be read, so a conflict could be missing. See its import report.`,
        blocking: false,
      });
    }
  }

  const status: FeasibilityStatus = hard.length
    ? "conflicts"
    : uncoveredDates.length
      ? "calendar coverage incomplete"
      : missing.some((m) => m.blocking)
        ? "needs confirmation"
        : "no conflicts found";

  return { status, summary: summarize(status, hard, soft, uncoveredDates), plan, hardConflicts: hard, softWarnings: soft, missingInformation: missing, uncoveredDates };
}
