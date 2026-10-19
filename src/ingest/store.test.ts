import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeOpportunity } from "@/lib/testFixtures";
import { InvalidOpportunityError } from "@/lib/validate";
import { StoreError, createStore, hashText, type Store } from "./store";
import type { PendingRecord } from "./types";

const SRC = "https://maple.example/2026";
const realListing = () =>
  makeOpportunity({
    id: "real-maple-hacks-2026-11-14",
    name: "Maple Hacks 2026",
    sourceUrl: SRC,
    registrationFee: null,
    travelCostEstimate: null,
    eligibility: { studentStatusRequired: null, universities: null, programs: null, years: null, experienceLevels: null, otherRequirements: null },
    evidence: {
      start: { quote: "November 14, 2026, 9 AM", sourceUrl: SRC },
      end: { quote: "November 14, 2026, 5 PM", sourceUrl: SRC },
      applicationDeadline: { quote: "Apply by November 1, 2026 at 11:59 PM", sourceUrl: SRC },
    },
  });

let dir: string;
let store: Store;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "can-i-go-store-"));
  store = createStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("store", () => {
  it("returns empty data when files don't exist yet", async () => {
    expect(await store.readListings()).toEqual([]);
    expect(await store.readPending()).toEqual([]);
    expect(await store.readState()).toEqual({});
  });

  it("round-trips listings, pending records and state", async () => {
    await store.writeListings([realListing()]);
    expect(await store.readListings()).toEqual([realListing()]);

    const pending: PendingRecord = { opportunity: realListing(), itemKey: SRC, textHash: hashText("x"), fetchedAt: "2026-10-18T12:00:00.000Z", fields: [], updateOf: null };
    await store.writePending([pending]);
    expect(await store.readPending()).toEqual([pending]);

    const state = { [SRC]: { textHash: hashText("x"), lastFetched: "2026-10-18T12:00:00.000Z", outcome: "pending" as const } };
    await store.writeState(state);
    expect(await store.readState()).toEqual(state);
  });

  it("validates before writing and leaves the old file untouched on failure", async () => {
    await store.writeListings([realListing()]);
    const before = await readFile(store.files.listings, "utf8");

    await expect(store.writeListings([{ ...realListing(), start: "2026-02-30T09:00:00-05:00" }])).rejects.toThrow(/invalid "start"/);
    await expect(store.writeListings([{ ...realListing(), end: "2026-11-13T09:00:00-05:00" }])).rejects.toThrow(/ends before it starts/);
    await expect(store.writeListings([{ ...realListing(), evidence: {} }])).rejects.toThrow(InvalidOpportunityError);

    expect(await readFile(store.files.listings, "utf8")).toBe(before);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses malformed files with a clear message", async () => {
    await writeFile(store.files.listings, "{not json");
    await expect(store.readListings()).rejects.toThrow(StoreError);
    await writeFile(store.files.state, JSON.stringify({ a: { textHash: "nope", lastFetched: "x", outcome: "pending" } }));
    await expect(store.readState()).rejects.toThrow(/invalid entry/);
    await writeFile(store.files.pending, JSON.stringify([{ itemKey: 1 }]));
    await expect(store.readPending()).rejects.toThrow(/malformed pending record/);
  });

  it("hashes text with sha256", () => {
    expect(hashText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});
