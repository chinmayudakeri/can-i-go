import type { Opportunity } from "@/lib/types";
import type { Basis } from "./evidence";

/** One field's outcome, shown side by side with its quote in `npm run review`. */
export interface FieldReport {
  field: string;
  status: "kept" | "discarded" | "missing";
  value: unknown;
  quote: string | null;
  basis: Basis | null;
  /** Why a value was discarded, or a note about a kept one (e.g. "kept the date only"). */
  reason?: string;
}

/** An extracted, validated record waiting for human review. */
export interface PendingRecord {
  opportunity: Opportunity;
  /** Identifies the source document (feed URL + item id, or page URL). */
  itemKey: string;
  textHash: string;
  fetchedAt: string;
  fields: FieldReport[];
  /** Id of the existing listing this would update, or null if it's new. */
  updateOf: string | null;
}

export type ItemOutcome = "pending" | "approved" | "rejected" | "failed";

/** What we know about each source document, keyed by itemKey. */
export interface ItemState {
  textHash: string;
  lastFetched: string;
  outcome: ItemOutcome;
  listingId?: string;
}

export type IngestState = Record<string, ItemState>;
