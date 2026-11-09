import { coverageOf, eventsAsCommitments } from "../calendar/store";
import type { CalendarCoverage, CalendarStore, Commitment } from "../calendar/types";
import type { SavedOpportunity } from "../shortlist";
import type { Opportunity, StudentProfile } from "../types";
import { assumptionsFromProfile, type AssumptionsUsed } from "./assumptions";
import { checkFeasibility } from ".";
import type { FeasibilityResult, ShortlistEntry } from "./types";
import { feasibilityView, type FeasibilityView } from "./view";

/** Everything the browser knows about the student, gathered once per render of a list. */
export interface StudentContext {
  profile: StudentProfile | null;
  commitments: Commitment[];
  coverage: CalendarCoverage[];
  calendarsConnected: boolean;
  shortlist: SavedOpportunity[];
  shortlistEntries: ShortlistEntry[];
  timezone: string;
}

export function buildStudentContext(args: {
  profile: StudentProfile | null;
  calendar: CalendarStore;
  manual: Commitment[];
  shortlist: SavedOpportunity[];
  opportunities: Opportunity[];
  timezone: string;
}): StudentContext {
  const byId = new Map(args.opportunities.map((o) => [o.id, o]));
  return {
    profile: args.profile,
    commitments: [...eventsAsCommitments(args.calendar), ...args.manual],
    coverage: coverageOf(args.calendar),
    calendarsConnected: args.calendar.calendars.length > 0,
    shortlist: args.shortlist,
    // Saved events no source returns any more are skipped here (the shortlist page lists them as missing).
    shortlistEntries: args.shortlist.flatMap((s) => {
      const opportunity = byId.get(s.opportunityId);
      if (!opportunity) return [];
      return [{ opportunity, oneWayTravelMinutes: assumptionsFromProfile(args.profile, s.travelMinutesOverride, args.timezone).assumptions.oneWayTravelMinutes }];
    }),
    timezone: args.timezone,
  };
}

export interface OpportunityFeasibility {
  result: FeasibilityResult;
  view: FeasibilityView;
  used: AssumptionsUsed;
}

export function feasibilityFor(opp: Opportunity, ctx: StudentContext, now: Date): OpportunityFeasibility {
  const saved = ctx.shortlist.find((s) => s.opportunityId === opp.id);
  const used = assumptionsFromProfile(ctx.profile, saved?.travelMinutesOverride ?? null, ctx.timezone);
  const result = checkFeasibility({
    opportunity: opp,
    commitments: ctx.commitments,
    coverage: ctx.coverage,
    assumptions: used.assumptions,
    shortlist: ctx.shortlistEntries,
    now,
  });
  return { result, view: feasibilityView(result, ctx.calendarsConnected), used };
}
