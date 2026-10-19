/**
 * npm run review: walk through data/real/pending.json. Each field is shown
 * next to the quote that supports it. a = approve (→ listings.json),
 * r = reject (not proposed again unless the page changes), s = skip, q = quit.
 * Every decision is saved immediately.
 */
import { createInterface } from "node:readline/promises";
import { mergeOpportunities } from "@/ingest/dedupe";
import { approvePending, formatFieldTable, rejectPending, terminalSafe, type ReviewData } from "@/ingest/review";
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
  for (let seen = 1; index < data.pending.length; seen++) {
    const record = data.pending[index];
    const o = record.opportunity;
    const existing = record.updateOf ? data.listings.find((l) => l.id === record.updateOf) : undefined;
    console.log(`\n${"═".repeat(width)}`);
    console.log(terminalSafe(`[${seen}/${total}] ${o.name}  (${o.id})`));
    console.log(terminalSafe(existing ? `Update to existing listing ${existing.id}` : "New listing"));
    console.log(terminalSafe(`Source: ${o.sourceUrl}`));
    console.log(terminalSafe(`Fetched: ${record.fetchedAt}   Dates: ${o.start} → ${o.end}   Deadline: ${o.applicationDeadline ?? "Unknown"}`));
    if (existing) {
      const { conflicts } = mergeOpportunities(existing, o);
      if (conflicts.length) console.log(terminalSafe(`Changes vs current listing: ${conflicts.join(", ")}`));
    }
    console.log(`${"─".repeat(width)}\n${formatFieldTable(record.fields, width)}`);

    const answer = (await rl.question("\n[a]pprove  [r]eject  [s]kip  [q]uit > ")).trim().toLowerCase();
    if (answer === "q") break;
    if (answer === "a") {
      try {
        const result = approvePending(data, index);
        data = result;
        await save();
        console.log(`✓ ${result.action === "added" ? "Added" : "Merged into"} ${result.id}${result.conflicts.length ? ` (changed: ${result.conflicts.join(", ")})` : ""}`);
      } catch (err) {
        console.log(`✗ Can't approve: ${(err as Error).message}`);
        index++;
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
