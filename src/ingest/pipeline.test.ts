import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RetryableError } from "./backoff";
import { MockProvider } from "./extract/mock";
import { ProviderError } from "./extract/types";
import { runIngest } from "./pipeline";
import { approvePending, rejectPending } from "./review";
import { createStore, type Store } from "./store";
import { PAGE, f, fakeAdapter, goodResponse, makeDoc } from "./testFixtures";

const noSleep = async () => {};
let dir: string;
let store: Store;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "can-i-go-pipeline-"));
  store = createStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const good = () => new MockProvider(() => goodResponse());
const ingest = (docs: Parameters<typeof fakeAdapter>[0], provider: MockProvider, maxCalls?: number) =>
  runIngest({ adapters: [fakeAdapter(docs)], provider, store, maxCalls, sleep: noSleep });

async function approveAll() {
  let data = { pending: await store.readPending(), listings: await store.readListings(), state: await store.readState() };
  while (data.pending.length) data = approvePending(data, 0);
  await store.writeListings(data.listings);
  await store.writePending(data.pending);
  await store.writeState(data.state);
}

describe("runIngest", () => {
  it("writes verified records to pending, never straight to listings", async () => {
    const report = await ingest([makeDoc()], good());
    expect(report).toMatchObject({ documents: 1, pending: 1, callsUsed: 1, callCap: 20 });
    const [record] = await store.readPending();
    expect(record).toMatchObject({ itemKey: makeDoc().itemKey, updateOf: null, opportunity: { id: "real-maple-hacks-2026-11-14" } });
    expect(await store.readListings()).toEqual([]);
    expect(Object.values(await store.readState())[0]).toMatchObject({ outcome: "pending" });
  });

  it("skips extraction when a page is unchanged", async () => {
    const provider = good();
    await ingest([makeDoc()], provider);
    const second = await ingest([makeDoc({ fetchedAt: "2026-10-19T16:00:00.000Z" })], provider);
    expect(provider.calls).toHaveLength(1);
    expect(second).toMatchObject({ skippedUnchanged: 1, pending: 0, callsUsed: 0 });
  });

  it("re-extracts when the page text changes, replacing the pending record", async () => {
    const provider = good();
    await ingest([makeDoc()], provider);
    await ingest([makeDoc({ text: `${PAGE}\nSponsor announcements coming soon.` })], provider);
    expect(provider.calls).toHaveLength(2);
    expect(await store.readPending()).toHaveLength(1);
  });

  it("bumps lastVerified on approved listings whose page is unchanged, without a call", async () => {
    const provider = good();
    await ingest([makeDoc()], provider);
    await approveAll();
    const report = await ingest([makeDoc({ fetchedAt: "2026-10-25T16:00:00.000Z" })], provider);
    expect(provider.calls).toHaveLength(1);
    expect(report.reverified).toBe(1);
    expect((await store.readListings())[0].lastVerified).toBe("2026-10-25");
  });

  it("doesn't propose rejected pages again unless they change", async () => {
    const provider = good();
    await ingest([makeDoc()], provider);
    const data = rejectPending({ pending: await store.readPending(), listings: [], state: await store.readState() }, 0);
    await store.writePending(data.pending);
    await store.writeState(data.state);
    await ingest([makeDoc()], provider);
    expect(provider.calls).toHaveLength(1);
    expect(await store.readPending()).toEqual([]);
  });

  it("respects the call cap and leaves the rest for the next run", async () => {
    const provider = good();
    const docs = Array.from({ length: 25 }, (_, i) => makeDoc({ itemKey: `page:https://maple.example/${i}`, text: `${PAGE}\nRef ${i}` }));
    const report = await ingest(docs, provider);
    expect(provider.calls).toHaveLength(20);
    expect(report).toMatchObject({ callsUsed: 20, pending: 20, deferred: 5 });

    const next = await ingest(docs, provider);
    expect(provider.calls).toHaveLength(25);
    expect(next).toMatchObject({ skippedUnchanged: 20, callsUsed: 5, deferred: 0 });
  });

  it("counts retries against the cap", async () => {
    const provider = new MockProvider(() => {
      throw new RetryableError("429");
    });
    const docs = [1, 2, 3].map((i) => makeDoc({ itemKey: `k${i}`, text: `${PAGE}\n${i}` }));
    const report = await ingest(docs, provider, 7);
    expect(provider.calls).toHaveLength(7);
    expect(report).toMatchObject({ callsUsed: 7, deferred: 2 });
    expect(report.failed).toHaveLength(1);
  });

  it("backs off on a rate limit and then succeeds", async () => {
    const provider = new MockProvider((_input, i) => {
      if (i === 0) throw new RetryableError("429", 10);
      return goodResponse();
    });
    const report = await ingest([makeDoc()], provider);
    expect(provider.calls).toHaveLength(2);
    expect(report.pending).toBe(1);
  });

  it("retries provider failures next run instead of recording them", async () => {
    const broken = new MockProvider(() => {
      throw new Error("socket hang up");
    });
    const report = await ingest([makeDoc()], broken);
    expect(report.failed[0].reason).toBe("socket hang up");
    expect(await store.readState()).toEqual({});
    const provider = good();
    await ingest([makeDoc()], provider);
    expect(provider.calls).toHaveLength(1);
  });

  it("stops the whole run on a fatal provider error (e.g. invalid key)", async () => {
    const provider = new MockProvider(() => {
      throw new ProviderError("Gemini HTTP 400: API key not valid", true);
    });
    const docs = [1, 2, 3].map((i) => makeDoc({ itemKey: `k${i}`, text: `${PAGE}\n${i}` }));
    const report = await ingest(docs, provider);
    expect(provider.calls).toHaveLength(1);
    expect(report.stoppedEarly).toMatch(/API key/);
  });

  it("records malformed or unusable output as rejected without crashing", async () => {
    const outputs: unknown[] = ["garbage", null, { isEvent: false }, goodResponse({ start: f("2026-11-14", "not on the page at all") })];
    const provider = new MockProvider((_input, i) => outputs[i]);
    const docs = outputs.map((_, i) => makeDoc({ itemKey: `k${i}`, text: `${PAGE}\n${i}` }));
    const report = await ingest(docs, provider);
    expect(report.rejected).toHaveLength(4);
    expect(report.pending).toBe(0);
    expect(Object.values(await store.readState()).every((s) => s.outcome === "failed")).toBe(true);
  });

  it("records adapter failures and carries on", async () => {
    const failing = { name: "broken feed", fetchDocuments: () => Promise.reject(new Error("HTTP 503")) };
    const report = await runIngest({ adapters: [failing, fakeAdapter([makeDoc()])], provider: good(), store, sleep: noSleep });
    expect(report.failed).toEqual([{ source: "broken feed", reason: "HTTP 503" }]);
    expect(report.pending).toBe(1);
  });

  it("writes nothing on a dry run", async () => {
    await runIngest({ adapters: [fakeAdapter([makeDoc()])], provider: good(), store, dryRun: true, sleep: noSleep });
    expect(await store.readPending()).toEqual([]);
    expect(await store.readState()).toEqual({});
  });
});

describe("duplicates across sources", () => {
  it("merges the same event from two pages into one listing with both sources", async () => {
    const a = makeDoc({ itemKey: "page:https://maple.example/2026", sourceUrl: "https://maple.example/2026" });
    const b = makeDoc({ itemKey: "page:https://club.example/maple", sourceUrl: "https://club.example/maple", fetchedAt: "2026-10-20T16:00:00.000Z" });
    await ingest([a, b], good());
    expect(await store.readPending()).toHaveLength(2);
    await approveAll();
    const listings = await store.readListings();
    expect(listings).toHaveLength(1);
    expect(listings[0].sourceUrls?.sort()).toEqual(["https://club.example/maple", "https://maple.example/2026"]);
    expect(listings[0].lastVerified).toBe("2026-10-20");
  });

  it("marks a new extraction of an existing event as an update to it", async () => {
    await ingest([makeDoc()], good());
    await approveAll();
    await ingest([makeDoc({ itemKey: "page:https://club.example/maple", sourceUrl: "https://club.example/maple" })], good());
    const [record] = await store.readPending();
    expect(record.updateOf).toBe("real-maple-hacks-2026-11-14");
    expect(record.opportunity.id).toBe("real-maple-hacks-2026-11-14");
  });
});
