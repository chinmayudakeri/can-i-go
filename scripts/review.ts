/**
 * npm run review: walk through data/real/pending.json. Each field is shown
 * next to the quote that supports it. a = approve (→ listings.json),
 * r = reject (not proposed again unless the page changes), s = skip, q = quit.
 * Every decision is saved immediately.
 */
import { createInterface } from "node:readline/promises";
import { mergeOpportunities } from "@/ingest/dedupe";
import {
  approvePending,
  describeListingTimezone,
  describeTimezoneStatus,
  formatFieldTable,
  rejectPending,
  terminalSafe,
  type ReviewData,
  type ReviewerTimezone,
} from "@/ingest/review";
import { NEEDS_REVIEWER_TIMEZONE, ReviewInputError, draftId, validateReviewerNote, validateReviewerTimezone } from "@/ingest/timezoneDraft";
import { createStore } from "@/ingest/store";

async function main() {
  if (!process.stdin.isTTY) {
    console.error("✗ npm run review needs an interactive terminal.");
    process.exit(1);
  }
  const store = createStore();
  let data: ReviewData = { pending: await store.readPending(), listings: await store.readListings(), state: await store.readState() };
  if (!data.pending.length) {
    console.log("Nothing pending. Run `npm run ingest` first.");
    return;
  }
  const save = async () => {
    await store.writeListings(data.listings);
    await store.writePending(data.pending);
    await store.writeState(data.state);
  };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const width = Math.min(process.stdout.columns || 100, 140);
  let index = 0;
  const total = data.pending.length;
  while (index < data.pending.length) {
    const position = total - data.pending.length + index + 1;
    const record = data.pending[index];
    const flagged = record.flag === NEEDS_REVIEWER_TIMEZONE;
    const name = flagged ? record.draft.name : record.opportunity.name;
    const id = flagged ? draftId(record.draft) : record.opportunity.id;
    const sourceUrl = flagged ? record.draft.sourceUrl : record.opportunity.sourceUrl;
    const existing = record.updateOf ? data.listings.find((l) => l.id === record.updateOf) : undefined;
    console.log(`\n${"═".repeat(width)}`);
    console.log(terminalSafe(`[${position}/${total}] ${name}  (${id})`));
    console.log(terminalSafe(existing ? `Update to existing listing ${existing.id}` : "New listing"));
    console.log(terminalSafe(`Source: ${sourceUrl}`));
    if (flagged) {
      console.log(terminalSafe(`Fetched: ${record.fetchedAt}`));
    } else {
      const o = record.opportunity;
      console.log(terminalSafe(`Fetched: ${record.fetchedAt}   Dates: ${o.start} → ${o.end}   Deadline: ${o.applicationDeadline ?? "Unknown"}`));
      if (existing) {
        const { conflicts } = mergeOpportunities(existing, o);
        if (conflicts.length) console.log(terminalSafe(`Changes vs current listing: ${conflicts.join(", ")}`));
      }
    }
    console.log(describeTimezoneStatus(record));
    if (existing?.timezoneConfirmation) console.log(`Current listing: ${describeListingTimezone(existing)} (not reused; confirm again)`);
    console.log(`${"─".repeat(width)}\n${formatFieldTable(record.fields, width)}`);

    const answer = (await rl.question("\n[a]pprove  [r]eject  [s]kip  [q]uit > ")).trim().toLowerCase();
    if (answer === "q") break;
    if (answer === "a") {
      try {
        let reviewerTimezone: ReviewerTimezone | undefined;
        if (flagged) {
          // Typed by the reviewer only. Nothing is suggested or pre-filled.
          const timezone = validateReviewerTimezone(await rl.question("IANA timezone you verified (e.g. America/Toronto): "));
          const note = validateReviewerNote(await rl.question("How did you verify it? (short note or URL, e.g. the venue's official site): "));
          reviewerTimezone = { timezone, note };
        }
        const result = approvePending(data, index, reviewerTimezone);
        data = result;
        await save();
        console.log(`✓ ${result.action === "added" ? "Added" : "Merged into"} ${result.id}${result.conflicts.length ? ` (changed: ${result.conflicts.join(", ")})` : ""}`);
        const saved = data.listings.find((l) => l.id === result.id);
        if (saved?.timezoneConfirmation) console.log(`  ${describeListingTimezone(saved)}`);
      } catch (err) {
        console.log(`✗ Can't approve: ${(err as Error).message}`);
        // Bad timezone or note: stay on this record so you can try again.
        if (!(err instanceof ReviewInputError)) index++;
      }
    } else if (answer === "r") {
      data = rejectPending(data, index);
      await save();
      console.log("✓ Rejected");
    } else {
      index++;
    }
  }
  rl.close();
  console.log(`\n${data.pending.length} record(s) still pending.`);
}

main().catch((err: Error) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
