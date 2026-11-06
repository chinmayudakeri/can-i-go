import type { Opportunity } from "@/lib/types";
import type { Basis } from "./evidence";
import type { NEEDS_REVIEWER_TIMEZONE, TimezoneDraft } from "./timezoneDraft";

export const DERIVED_FROM_LOCATION = "derived from stated location";

/** One field's outcome, shown side by side with its quote in `npm run review`. */
export interface FieldReport {
  field: string;
  status: "kept" | "discarded" | "missing";
  value: unknown;
  quote: string | null;
  /** Dates: the separate fragment the time of day was verified against, if any. */
  timeQuote?: string | null;
  /** "derived from stated location" for the timezone, which code derives rather than the model. */
  basis: Basis | typeof DERIVED_FROM_LOCATION | null;
  /** Why a value was discarded, or a note about a kept one (e.g. "kept the date only"). */
  reason?: string;
}

interface PendingBase {
  /** Identifies the source document (feed URL + item id, or page URL). */
  itemKey: string;
  textHash: string;
  fetchedAt: string;
  fields: FieldReport[];
  /** Id of the existing listing this would update, or null if it's new. */
  updateOf: string | null;
}

/** An extracted, validated record waiting for human review. */
export type PendingRecord =
  | (PendingBase & { opportunity: Opportunity; flag?: undefined })
  /** Everything verified except the timezone: can't be approved until the reviewer types a zone and a note. */
  | (PendingBase & { opportunity: null; flag: typeof NEEDS_REVIEWER_TIMEZONE; draft: TimezoneDraft });

export type ItemOutcome = "pending" | "approved" | "rejected" | "failed";

/** What we know about each source document, keyed by itemKey. */
export interface ItemState {
  textHash: string;
  lastFetched: string;
  outcome: ItemOutcome;
  listingId?: string;
}

export type IngestState = Record<string, ItemState>;
