import type { Opportunity } from "@/lib/types";

/**
 * Anything that can supply opportunities: demo data now, real ingestion later.
 * The UI only ever talks to this interface, so adding a source needs no UI changes.
 */
export interface OpportunitySource {
  /** Human-readable name, used in error messages. */
  readonly name: string;
  getOpportunities(): Promise<Opportunity[]>;
}
