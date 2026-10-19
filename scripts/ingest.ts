/**
 * npm run ingest                      → every feed in data/real/feeds.json
 * npm run ingest -- --url <link>      → one event page you chose
 * Options: --max-calls N (default 20), --dry-run (write nothing)
 *
 * Results go to data/real/pending.json for `npm run review`. Nothing is published without your approval.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { SingleUrlAdapter, adaptersForFeeds, type SourceAdapter } from "@/ingest/adapters";
import { DEFAULT_MAX_CALLS } from "@/ingest/budget";
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from "@/ingest/extract/gemini";
import { createGuardedFetch } from "@/ingest/fetcher";
import { runIngest } from "@/ingest/pipeline";
import { checkSitePolicy } from "@/ingest/policy";
import { parseSafeUrl } from "@/ingest/safeUrl";
import { createStore } from "@/ingest/store";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", multiple: true },
      "max-calls": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log("Usage: npm run ingest [-- --url <link>] [--max-calls N] [--dry-run]");
    return;
  }

  const maxCalls = values["max-calls"] === undefined ? DEFAULT_MAX_CALLS : Number(values["max-calls"]);
  if (!Number.isInteger(maxCalls) || maxCalls < 0) fail("--max-calls must be a whole number ≥ 0");

  const store = createStore();
  const fetch = createGuardedFetch();
  let adapters: SourceAdapter[];
  if (values.url?.length) {
    adapters = values.url.map((raw) => {
      const url = parseSafeUrl(raw);
      const policy = checkSitePolicy(url, "page");
      if (!policy.allowed) fail(`${url.hostname}: ${policy.reason}`);
      return new SingleUrlAdapter(url.href, fetch);
    });
    console.log("Note: robots.txt is checked automatically, but checking that site's terms of service is up to you.");
  } else {
    const feeds = await store.readFeeds();
    if (!feeds.length) fail(`No feeds configured. Add some to ${store.files.feeds} or use --url <link>. See README → Stage 2.`);
    adapters = adaptersForFeeds(feeds, fetch);
  }

  // After input checks, so a refused URL or missing feed is reported even without a key.
  if (existsSync(".env")) process.loadEnvFile(".env");
  const provider = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
  });

  console.log(`Extracting with ${provider.name}, at most ${maxCalls} call(s)${values["dry-run"] ? " (dry run)" : ""}…`);
  const report = await runIngest({ adapters, provider, store, maxCalls, dryRun: values["dry-run"], log: (m) => console.log(`  ${m}`) });

  console.log(`
Documents: ${report.documents}
Unchanged (no call): ${report.skippedUnchanged}${report.reverified ? `, ${report.reverified} listing(s) re-verified` : ""}
New pending: ${report.pending}
Rejected: ${report.rejected.length}
Failed (retried next run): ${report.failed.length}
Calls used: ${report.callsUsed}/${report.callCap}${report.deferred ? `; ${report.deferred} document(s) left for the next run` : ""}`);
  for (const r of report.rejected) console.log(`  rejected ${r.itemKey}: ${r.reason}`);
  for (const f of report.failed) console.log(`  failed ${f.source}: ${f.reason}`);
  if (report.stoppedEarly) fail(`stopped early: ${report.stoppedEarly}`);
  if (report.pending) console.log("\nRun `npm run review` to approve or reject.");
}

main().catch((err: Error) => fail(err.message));
