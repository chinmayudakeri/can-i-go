import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Opportunity } from "@/lib/types";
import { parseOpportunities } from "@/lib/validate";
import { parseFeedConfigs, type FeedConfig } from "./adapters";
import type { IngestState, ItemState, PendingRecord } from "./types";

/**
 * Reads and writes data/real/*.json. Every write is validated first and is
 * atomic (temp file + rename), so a failed or interrupted run never leaves a
 * half-written or invalid file behind.
 */

export const DEFAULT_DATA_DIR = path.join(process.cwd(), "data", "real");

export class StoreError extends Error {}

export { hashText } from "./hash";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new StoreError(`${file} is not valid JSON; fix or delete it`);
  }
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

const OUTCOMES = ["pending", "approved", "rejected", "failed"];

function validateState(raw: unknown, file: string): IngestState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StoreError(`${file}: expected an object`);
  for (const [key, entry] of Object.entries(raw as Record<string, Partial<ItemState>>)) {
    const ok =
      entry &&
      typeof entry.textHash === "string" &&
      /^[0-9a-f]{64}$/.test(entry.textHash) &&
      typeof entry.lastFetched === "string" &&
      OUTCOMES.includes(entry.outcome as string) &&
      (entry.listingId === undefined || typeof entry.listingId === "string");
    if (!ok) throw new StoreError(`${file}: invalid entry for ${JSON.stringify(key)}`);
  }
  return raw as IngestState;
}

function validatePending(raw: unknown, file: string): PendingRecord[] {
  if (!Array.isArray(raw)) throw new StoreError(`${file}: expected an array`);
  for (const [i, r] of raw.entries()) {
    const rec = r as Partial<PendingRecord>;
    const ok =
      rec &&
      typeof rec.itemKey === "string" &&
      typeof rec.textHash === "string" &&
      typeof rec.fetchedAt === "string" &&
      Array.isArray(rec.fields) &&
      (rec.updateOf === null || typeof rec.updateOf === "string");
    if (!ok) throw new StoreError(`${file}[${i}]: malformed pending record`);
  }
  // Validated one by one: two sources may propose the same event (same id) until review merges them.
  raw.forEach((r: PendingRecord, i) => parseOpportunities([r.opportunity], `${file}[${i}]`, { real: true }));
  return raw as PendingRecord[];
}

export function createStore(dir: string = DEFAULT_DATA_DIR) {
  const files = {
    pending: path.join(dir, "pending.json"),
    listings: path.join(dir, "listings.json"),
    state: path.join(dir, "state.json"),
    feeds: path.join(dir, "feeds.json"),
  };

  return {
    dir,
    files,

    async readListings(): Promise<Opportunity[]> {
      return parseOpportunities(await readJson<unknown>(files.listings, []), files.listings, { real: true });
    },
    async writeListings(listings: Opportunity[]): Promise<void> {
      parseOpportunities(listings, "listings.json", { real: true });
      await writeJsonAtomic(files.listings, listings);
    },

    async readPending(): Promise<PendingRecord[]> {
      return validatePending(await readJson<unknown>(files.pending, []), files.pending);
    },
    async writePending(records: PendingRecord[]): Promise<void> {
      validatePending(records, "pending.json");
      await writeJsonAtomic(files.pending, records);
    },

    async readFeeds(): Promise<FeedConfig[]> {
      return parseFeedConfigs(await readJson<unknown>(files.feeds, []));
    },

    async readState(): Promise<IngestState> {
      return validateState(await readJson<unknown>(files.state, {}), files.state);
    },
    async writeState(state: IngestState): Promise<void> {
      validateState(state, "state.json");
      await writeJsonAtomic(files.state, state);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
