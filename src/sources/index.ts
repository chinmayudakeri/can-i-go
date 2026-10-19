import type { Opportunity } from "@/lib/types";
import { DemoSource } from "./demoSource";
import type { OpportunitySource } from "./types";

export type { OpportunitySource } from "./types";

/** Merges several sources into one. Later sources win on duplicate ids. */
export class CombinedSource implements OpportunitySource {
  readonly name = "All sources";

  constructor(private readonly sources: OpportunitySource[]) {}

  async getOpportunities(): Promise<Opportunity[]> {
    const lists = await Promise.all(this.sources.map((s) => s.getOpportunities()));
    const byId = new Map<string, Opportunity>();
    for (const opp of lists.flat()) byId.set(opp.id, opp);
    return [...byId.values()];
  }
}

/** Register new sources here. */
export const opportunitySource: OpportunitySource = new CombinedSource([new DemoSource()]);
