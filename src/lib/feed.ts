import { summarizeCosts, type CostSummary } from "./costs";
import { getDeadlineStatus, type DeadlineStatus } from "./deadline";
import { checkEligibility, type EligibilityResult, type EligibilityStatus } from "./eligibility";
import { explainRelevance, type Relevance } from "./relevance";
import type { Opportunity, OpportunityType, StudentProfile } from "./types";

export interface FeedItem {
  opportunity: Opportunity;
  eligibility: EligibilityResult;
  deadline: DeadlineStatus;
  costs: CostSummary;
  relevance: Relevance;
}

export type LocationFilter = "any" | "online" | "in-person" | `city:${string}`;
export type DeadlineFilter = "hide-passed" | "only-passed" | "all";
export type SortKey = "deadline" | "start" | "relevance" | "cost";

export interface FeedFilters {
  query: string;
  /** Empty = all types. */
  types: OpportunityType[];
  topic: string | null;
  location: LocationFilter;
  beginnerFriendlyOnly: boolean;
  eligibility: EligibilityStatus | "any";
  deadline: DeadlineFilter;
}

export const DEFAULT_FILTERS: FeedFilters = {
  query: "",
  types: [],
  topic: null,
  location: "any",
  beginnerFriendlyOnly: false,
  eligibility: "any",
  deadline: "hide-passed",
};

export function buildFeedItem(opp: Opportunity, profile: StudentProfile | null, now: Date): FeedItem {
  const costs = summarizeCosts(opp);
  return {
    opportunity: opp,
    eligibility: checkEligibility(opp, profile),
    deadline: getDeadlineStatus(opp, now),
    costs,
    relevance: explainRelevance(opp, profile, costs),
  };
}

function matchesQuery(opp: Opportunity, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    opp.name,
    opp.organizer,
    opp.description,
    opp.type,
    opp.location?.city ?? "online",
    opp.location?.country ?? "",
    ...opp.tags,
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

function matchesLocation(opp: Opportunity, location: LocationFilter): boolean {
  if (location === "any") return true;
  if (location === "online") return opp.format !== "in-person";
  if (location === "in-person") return opp.format !== "online";
  const city = location.slice("city:".length);
  return opp.format !== "online" && opp.location?.city === city;
}

export function filterFeed(items: FeedItem[], f: FeedFilters): FeedItem[] {
  return items.filter(({ opportunity: o, eligibility, deadline }) => {
    if (!matchesQuery(o, f.query)) return false;
    if (f.types.length > 0 && !f.types.includes(o.type)) return false;
    if (f.topic && !o.tags.includes(f.topic)) return false;
    if (!matchesLocation(o, f.location)) return false;
    if (f.beginnerFriendlyOnly && o.beginnerFriendly !== true) return false;
    if (f.eligibility !== "any" && eligibility.status !== f.eligibility) return false;
    if (f.deadline === "hide-passed" && deadline.kind === "passed") return false;
    if (f.deadline === "only-passed" && deadline.kind !== "passed") return false;
    return true;
  });
}

/** Lower rank sorts first. Open deadlines (soonest first), then unknown, then passed. */
function deadlineRank(d: DeadlineStatus): [number, number] {
  switch (d.kind) {
    case "uncertain":
    case "open":
      return [0, d.deadline.getTime()];
    case "unknown":
      return [1, 0];
    case "passed":
      return [2, -d.deadline.getTime()]; // most recently passed first
  }
}

/** Fully-known costs first (cheapest first), then partially known, then nothing known. */
function costRank(c: CostSummary): [number, number] {
  if (c.complete && c.knownTotal) return [0, c.knownTotal.amount];
  if (c.knownTotal) return [1, c.knownTotal.amount];
  return [2, 0];
}

function compareTuples(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

const byStart = (a: FeedItem, b: FeedItem) =>
  new Date(a.opportunity.start).getTime() - new Date(b.opportunity.start).getTime();
const byName = (a: FeedItem, b: FeedItem) => a.opportunity.name.localeCompare(b.opportunity.name);
const byDeadline = (a: FeedItem, b: FeedItem) => compareTuples(deadlineRank(a.deadline), deadlineRank(b.deadline));

const COMPARATORS: Record<SortKey, (a: FeedItem, b: FeedItem) => number> = {
  deadline: (a, b) => byDeadline(a, b) || byStart(a, b) || byName(a, b),
  start: (a, b) => byStart(a, b) || byName(a, b),
  relevance: (a, b) =>
    b.relevance.forCount - b.relevance.againstCount - (a.relevance.forCount - a.relevance.againstCount) ||
    byDeadline(a, b) ||
    byName(a, b),
  cost: (a, b) => compareTuples(costRank(a.costs), costRank(b.costs)) || byDeadline(a, b) || byName(a, b),
};

export function sortFeed(items: FeedItem[], sort: SortKey): FeedItem[] {
  return [...items].sort(COMPARATORS[sort]);
}

export function getFeed(
  opportunities: Opportunity[],
  profile: StudentProfile | null,
  filters: FeedFilters,
  sort: SortKey,
  now: Date,
): FeedItem[] {
  const items = opportunities.map((o) => buildFeedItem(o, profile, now));
  return sortFeed(filterFeed(items, filters), sort);
}

/** Options for the filter dropdowns, derived from the data so they never go stale. */
export function getFilterOptions(opportunities: Opportunity[]) {
  const unique = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return {
    types: unique(opportunities.map((o) => o.type)) as OpportunityType[],
    topics: unique(opportunities.flatMap((o) => o.tags)),
    cities: unique(opportunities.flatMap((o) => (o.format !== "online" && o.location ? [o.location.city] : []))),
  };
}
