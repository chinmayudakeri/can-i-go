import { parseOpportunities } from "@/lib/validate";
import type { Opportunity } from "@/lib/types";
import type { OpportunitySource } from "./types";

/** Reads the fictional events in /data/demo.json. */
export class DemoSource implements OpportunitySource {
  readonly name = "Demo data";

  async getOpportunities(): Promise<Opportunity[]> {
    const mod = await import("@data/demo.json");
    return parseOpportunities(mod.default, this.name);
  }
}
