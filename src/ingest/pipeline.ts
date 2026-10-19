import type { Opportunity } from "@/lib/types";
import { InvalidOpportunityError, parseOpportunities } from "@/lib/validate";
import type { SourceAdapter } from "./adapters";
import { BudgetExhaustedError, CallBudget, DEFAULT_MAX_CALLS } from "./budget";
import { dedupeKey } from "./dedupe";
import { extractOpportunity } from "./extract/extractOpportunity";
import { ProviderError, type ExtractionProvider } from "./extract/types";
import { hashText } from "./hash";
import type { Store } from "./store";
import { waterlooDate } from "./time";
import type { PendingRecord } from "./types";

export interface IngestOptions {
  adapters: SourceAdapter[];
  provider: ExtractionProvider;
  store: Store;
  maxCalls?: number;
  dryRun?: boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface IngestReport {
  documents: number;
  /** Unchanged since last run, so no extraction call was made. */
  skippedUnchanged: number;
  /** Unchanged and already approved: lastVerified bumped without a call. */
  reverified: number;
  /** New records added to pending.json. */
  pending: number;
  /** Extracted but rejected (missing required facts or invalid). */
  rejected: { itemKey: string; reason: string }[];
  /** Adapters or documents that failed (network, blocked by policy/robots, provider error). Retried next run. */
  failed: { source: string; reason: string }[];
  /** Documents left for a later run because the call cap was reached. */
  deferred: number;
  callsUsed: number;
  callCap: number;
  /** Set when the run stopped early on a configuration error (e.g. invalid API key). */
  stoppedEarly: string | null;
}

/**
 * Fetch → hash check → extract (capped) → verify/validate → pending.json.
 * Nothing goes to listings.json except a lastVerified bump for unchanged,
 * already-approved pages; new data always waits for `npm run review`.
 */
export async function runIngest(options: IngestOptions): Promise<IngestReport> {
  const { adapters, provider, store, dryRun = false, sleep, log = () => {} } = options;
  const budget = new CallBudget(options.maxCalls ?? DEFAULT_MAX_CALLS);
  const [state, pendingList, listings] = await Promise.all([store.readState(), store.readPending(), store.readListings()]);
  let pending = pendingList;
  let nextListings: Opportunity[] = listings;
  let listingsChanged = false;

  const report: IngestReport = {
    documents: 0,
    skippedUnchanged: 0,
    reverified: 0,
    pending: 0,
    rejected: [],
    failed: [],
    deferred: 0,
    callsUsed: 0,
    callCap: budget.cap,
    stoppedEarly: null,
  };

  run: for (const adapter of adapters) {
    let docs;
    try {
      docs = await adapter.fetchDocuments();
    } catch (err) {
      report.failed.push({ source: adapter.name, reason: (err as Error).message });
      log(`✗ ${adapter.name}: ${(err as Error).message}`);
      continue;
    }
    log(`${adapter.name}: ${docs.length} document(s)`);

    for (const doc of docs) {
      report.documents++;
      const textHash = hashText(doc.text);
      const prev = state[doc.itemKey];

      if (prev && prev.textHash === textHash) {
        report.skippedUnchanged++;
        if (prev.outcome === "approved" && prev.listingId) {
          const verified = waterlooDate(doc.fetchedAt);
          nextListings = nextListings.map((l) => {
            if (l.id !== prev.listingId || l.lastVerified >= verified) return l;
            listingsChanged = true;
            report.reverified++;
            return { ...l, lastVerified: verified };
          });
        }
        state[doc.itemKey] = { ...prev, lastFetched: doc.fetchedAt };
        continue;
      }

      if (budget.remaining === 0) {
        report.deferred++;
        continue;
      }

      let result;
      try {
        result = await extractOpportunity(doc.text, doc.sourceUrl, { provider, budget, fetchedAt: doc.fetchedAt, sleep });
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          report.deferred++;
          continue;
        }
        // Provider or network trouble: leave state untouched so the next run tries again.
        report.failed.push({ source: doc.itemKey, reason: (err as Error).message });
        log(`✗ ${doc.itemKey}: ${(err as Error).message}`);
        if (err instanceof ProviderError && err.fatal) {
          report.stoppedEarly = err.message;
          break run;
        }
        continue;
      }

      if (!result.opportunity) {
        state[doc.itemKey] = { textHash, lastFetched: doc.fetchedAt, outcome: "failed" };
        report.rejected.push({ itemKey: doc.itemKey, reason: result.rejectReason ?? "unknown" });
        log(`– ${doc.itemKey}: rejected (${result.rejectReason})`);
        continue;
      }

      const match = nextListings.find((l) => dedupeKey(l) === dedupeKey(result.opportunity!));
      const opportunity = match ? { ...result.opportunity, id: match.id } : result.opportunity;
      try {
        parseOpportunities([opportunity], doc.itemKey, { real: true });
      } catch (err) {
        if (!(err instanceof InvalidOpportunityError)) throw err;
        state[doc.itemKey] = { textHash, lastFetched: doc.fetchedAt, outcome: "failed" };
        report.rejected.push({ itemKey: doc.itemKey, reason: err.message });
        continue;
      }

      const record: PendingRecord = {
        opportunity,
        itemKey: doc.itemKey,
        textHash,
        fetchedAt: doc.fetchedAt,
        fields: result.fields,
        updateOf: match?.id ?? null,
      };
      pending = [...pending.filter((p) => p.itemKey !== doc.itemKey), record];
      state[doc.itemKey] = { textHash, lastFetched: doc.fetchedAt, outcome: "pending", ...(prev?.listingId ? { listingId: prev.listingId } : {}) };
      report.pending++;
      log(`+ ${opportunity.name}: pending review${match ? ` (update to ${match.id})` : ""}`);
    }
  }

  report.callsUsed = budget.used;
  if (!dryRun) {
    // State last: if a write fails, the next run redoes the work instead of skipping it.
    await store.writePending(pending);
    if (listingsChanged) await store.writeListings(nextListings);
    await store.writeState(state);
  }
  return report;
}
