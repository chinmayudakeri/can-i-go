import { parseOpportunities } from "@/lib/validate";
import type { Opportunity } from "@/lib/types";
import type { OpportunitySource } from "./types";

/**
 * Reviewed real listings from /data/real/listings.json. Only `npm run review`
 * writes that file; every record needs a source URL, a verification date and
 * quotes for its dates, deadline, eligibility and costs.
 */
export class RealSource implements OpportunitySource {
  readonly name = "Real listings";

  async getOpportunities(): Promise<Opportunity[]> {
    const mod = await import("@data/real/listings.json");
    return parseOpportunities(mod.default, this.name, { real: true }).map((o) => ({ ...o, dataset: "real" as const }));
  }
}
