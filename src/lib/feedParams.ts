import { DEFAULT_FILTERS, type DeadlineFilter, type FeedFilters, type LocationFilter, type SortKey } from "./feed";
import { TYPE_LABELS } from "./format";
import type { OpportunityType } from "./types";

const SORTS: SortKey[] = ["relevance", "deadline", "start", "cost"];
const DEADLINES: DeadlineFilter[] = ["hide-passed", "only-passed", "all"];
const ELIGIBILITY = ["any", "matches", "does-not-match", "needs-confirmation"] as const;
export const DEFAULT_SORT: SortKey = "relevance";

/** Read filters from the URL, ignoring anything invalid. */
export function parseFeedParams(params: URLSearchParams): { filters: FeedFilters; sort: SortKey } {
  const get = (k: string) => params.get(k);
  const oneOf = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
    v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const location = get("location");

  return {
    sort: oneOf(get("sort"), SORTS, DEFAULT_SORT),
    filters: {
      query: get("q") ?? "",
      types: (get("type")?.split(",") ?? []).filter((t): t is OpportunityType => t in TYPE_LABELS),
      topic: get("topic") || null,
      location:
        location === "online" || location === "in-person" || location?.startsWith("city:")
          ? (location as LocationFilter)
          : "any",
      beginnerFriendlyOnly: get("beginner") === "1",
      eligibility: oneOf(get("eligibility"), ELIGIBILITY, "any"),
      deadline: oneOf(get("deadline"), DEADLINES, DEFAULT_FILTERS.deadline),
    },
  };
}

/** Write only non-default values, so the URL stays short. */
export function toFeedParams(filters: FeedFilters, sort: SortKey): URLSearchParams {
  const p = new URLSearchParams();
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (filters.query) p.set("q", filters.query);
  if (filters.types.length) p.set("type", filters.types.join(","));
  if (filters.topic) p.set("topic", filters.topic);
  if (filters.location !== "any") p.set("location", filters.location);
  if (filters.beginnerFriendlyOnly) p.set("beginner", "1");
  if (filters.eligibility !== "any") p.set("eligibility", filters.eligibility);
  if (filters.deadline !== DEFAULT_FILTERS.deadline) p.set("deadline", filters.deadline);
  return p;
}
