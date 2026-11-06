import type { Opportunity } from "@/lib/types";
import { InvalidOpportunityError, parseOpportunities } from "@/lib/validate";
import type { SourceAdapter } from "./adapters";
import { BudgetExhaustedError, CallBudget, DEFAULT_MAX_CALLS } from "./budget";
import { dedupeKey, dedupeKeyFromDate } from "./dedupe";
import { extractOpportunity } from "./extract/extractOpportunity";
import { ProviderError, type ExtractionProvider } from "./extract/types";
import { hashText } from "./hash";
import type { Store } from "./store";
import { waterlooDate } from "./time";
import { NEEDS_REVIEWER_TIMEZONE } from "./timezoneDraft";
import type { FieldReport, PendingRecord } from "./types";

export interface IngestOptions {
  adapters: SourceAdapter[];
  provider: ExtractionProvider;
  store: Store;
  maxCalls?: number;
  dryRun?: boolean;
  /**
   * Re-extract pages that state.json recorded as rejected (by the checks, or by you in review),
   * even if their text is unchanged. Pending and approved pages are still skipped. Calls stay capped.
   */
  force?: boolean;
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
  /** Of those, records waiting for the reviewer to type a timezone. */
  needsReviewerTimezone: number;
  /** Extracted but rejected (missing required facts or invalid), with every field's outcome for --show-rejected. */
  rejected: { itemKey: string; sourceUrl: string; reason: string; fields: FieldReport[] }[];
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
  const { adapters, provider, store, dryRun = false, force = false, sleep, log = () => {} } = options;
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
    needsReviewerTimezone: 0,
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

      const forced = force && (prev?.outcome === "failed" || prev?.outcome === "rejected");
      if (forced) log(`↻ ${doc.itemKey}: re-extracting (previously ${prev!.outcome === "failed" ? "rejected by the checks" : "rejected in review"})`);
      if (prev && prev.textHash === textHash && !forced) {
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
          if (err.lastError) {
            // The call was made and failed; say why rather than silently deferring.
            report.failed.push({ source: doc.itemKey, reason: err.message });
            log(`✗ ${doc.itemKey}: ${err.message}`);
          } else report.deferred++;
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

      if (result.needsReviewerTimezone && result.draft) {
        const draft = result.draft;
        const key = dedupeKeyFromDate(draft.name, draft.startLocal.slice(0, 10));
        const match = nextListings.find((l) => dedupeKey(l) === key);
        const record: PendingRecord = {
          opportunity: null,
          flag: NEEDS_REVIEWER_TIMEZONE,
          draft,
          itemKey: doc.itemKey,
          textHash,
          fetchedAt: doc.fetchedAt,
          fields: result.fields,
          updateOf: match?.id ?? null,
        };
        pending = [...pending.filter((p) => p.itemKey !== doc.itemKey), record];
        state[doc.itemKey] = { textHash, lastFetched: doc.fetchedAt, outcome: "pending", ...(prev?.listingId ? { listingId: prev.listingId } : {}) };
        report.pending++;
        report.needsReviewerTimezone++;
        log(`+ ${draft.name}: pending review, ${NEEDS_REVIEWER_TIMEZONE}${match ? ` (update to ${match.id})` : ""}`);
        continue;
      }

      if (!result.opportunity) {
        state[doc.itemKey] = { textHash, lastFetched: doc.fetchedAt, outcome: "failed" };
        report.rejected.push({ itemKey: doc.itemKey, sourceUrl: doc.sourceUrl, reason: result.rejectReason ?? "unknown", fields: result.fields });
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
        report.rejected.push({ itemKey: doc.itemKey, sourceUrl: doc.sourceUrl, reason: err.message, fields: result.fields });
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
