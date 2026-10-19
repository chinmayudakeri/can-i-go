import type { Opportunity } from "@/lib/types";

/**
 * Two records are the same event when their normalized names and local start
 * dates match. Merging keeps every source URL and the latest verification.
 */

/** Lowercase, accent-free, punctuation-free, without 4-digit years: "Hack the North 2026!" → "hack the north". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The start date (YYYY-MM-DD) in the event's own timezone. */
export function localStartDate(opp: Pick<Opportunity, "start" | "timezone">): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: opp.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(opp.start),
  );
}

export function dedupeKey(opp: Pick<Opportunity, "name" | "start" | "timezone">): string {
  return `${normalizeName(opp.name)}|${localStartDate(opp)}`;
}

/** Stable id for a real listing; the "real-" prefix can never collide with "demo-" ids. */
export function listingId(opp: Pick<Opportunity, "name" | "start" | "timezone">): string {
  const slug = normalizeName(opp.name).replace(/ /g, "-").slice(0, 60).replace(/-+$/, "") || "event";
  return `real-${slug}-${localStartDate(opp)}`;
}

export function allSourceUrls(opp: Opportunity): string[] {
  return [...new Set([opp.sourceUrl, ...(opp.sourceUrls ?? [])])];
}

const IGNORED_IN_CONFLICTS = new Set(["id", "sourceUrl", "sourceUrls", "lastVerified", "evidence"]);

export interface MergeResult {
  merged: Opportunity;
  /** Top-level fields whose values differ between the two records. */
  conflicts: string[];
}

/**
 * Merges two records of the same event. Field values (and their evidence)
 * come from the more recently verified record, so every value keeps the quote
 * it was checked against; incoming wins ties. The existing id is kept, all
 * source URLs are kept, and lastVerified is the later of the two.
 */
export function mergeOpportunities(existing: Opportunity, incoming: Opportunity): MergeResult {
  const winner = incoming.lastVerified >= existing.lastVerified ? incoming : existing;
  const loser = winner === incoming ? existing : incoming;
  const conflicts = (Object.keys(winner) as (keyof Opportunity)[]).filter(
    (key) => !IGNORED_IN_CONFLICTS.has(key) && JSON.stringify(winner[key]) !== JSON.stringify(loser[key]),
  );
  const sourceUrls = [...new Set([...allSourceUrls(winner), ...allSourceUrls(loser)])];
  return {
    merged: {
      ...winner,
      id: existing.id,
      sourceUrl: winner.sourceUrl,
      sourceUrls,
      lastVerified: winner.lastVerified,
    },
    conflicts,
  };
}

export interface UpsertResult {
  listings: Opportunity[];
  action: "added" | "updated";
  id: string;
  conflicts: string[];
}

/** Adds `incoming` to `listings`, merging it into an existing record of the same event if there is one. */
export function upsertListing(listings: Opportunity[], incoming: Opportunity): UpsertResult {
  const key = dedupeKey(incoming);
  const index = listings.findIndex((l) => dedupeKey(l) === key);
  if (index === -1) {
    const added = { ...incoming, sourceUrls: allSourceUrls(incoming) };
    return { listings: [...listings, added], action: "added", id: added.id, conflicts: [] };
  }
  const { merged, conflicts } = mergeOpportunities(listings[index], incoming);
  const next = [...listings];
  next[index] = merged;
  return { listings: next, action: "updated", id: merged.id, conflicts };
}

/** Collapses duplicates within one list. */
export function dedupeListings(list: Opportunity[]): Opportunity[] {
  return list.reduce<Opportunity[]>((acc, opp) => upsertListing(acc, opp).listings, []);
}
