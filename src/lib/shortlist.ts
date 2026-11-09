import type { KeyValueStore } from "./profileStorage";

/** Saved events, kept only in this browser's localStorage. */
export const SHORTLIST_STORAGE_KEY = "can-i-go.shortlist.v1";
export const MAX_NOTES_LENGTH = 2000;

export const APPLICATION_STATUSES = ["considering", "applied", "accepted", "waitlisted", "rejected", "attended"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  considering: "Considering",
  applied: "Applied",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  attended: "Attended",
};

export interface SavedOpportunity {
  opportunityId: string;
  /** ISO 8601. */
  addedAt: string;
  status: ApplicationStatus;
  notes: string;
  /** One-way travel minutes for this event; null uses the profile default. */
  travelMinutesOverride: number | null;
}

export function addToShortlist(list: SavedOpportunity[], opportunityId: string, now: Date): SavedOpportunity[] {
  if (list.some((s) => s.opportunityId === opportunityId)) return list;
  return [...list, { opportunityId, addedAt: now.toISOString(), status: "considering", notes: "", travelMinutesOverride: null }];
}

export function removeFromShortlist(list: SavedOpportunity[], opportunityId: string): SavedOpportunity[] {
  return list.filter((s) => s.opportunityId !== opportunityId);
}

export function updateSaved(
  list: SavedOpportunity[],
  opportunityId: string,
  patch: Partial<Pick<SavedOpportunity, "status" | "notes" | "travelMinutesOverride">>,
): SavedOpportunity[] {
  return list.map((s) => (s.opportunityId === opportunityId ? sanitizeSaved({ ...s, ...patch }) ?? s : s));
}

function sanitizeSaved(raw: unknown): SavedOpportunity | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.opportunityId !== "string" || !r.opportunityId) return null;
  const minutes = r.travelMinutesOverride;
  return {
    opportunityId: r.opportunityId,
    addedAt: typeof r.addedAt === "string" && !Number.isNaN(Date.parse(r.addedAt)) ? r.addedAt : new Date(0).toISOString(),
    status: APPLICATION_STATUSES.includes(r.status as ApplicationStatus) ? (r.status as ApplicationStatus) : "considering",
    notes: typeof r.notes === "string" ? r.notes.slice(0, MAX_NOTES_LENGTH) : "",
    travelMinutesOverride: typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0 ? minutes : null,
  };
}

export type ShortlistLoad = { ok: true; value: SavedOpportunity[]; dropped: number } | { ok: false; error: string };

export function loadShortlist(store: KeyValueStore): ShortlistLoad {
  try {
    const text = store.getItem(SHORTLIST_STORAGE_KEY);
    const raw: unknown = text === null ? [] : JSON.parse(text);
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const value = list.map(sanitizeSaved).filter((s): s is SavedOpportunity => !!s && !seen.has(s.opportunityId) && !!seen.add(s.opportunityId));
    return { ok: true, value, dropped: list.length - value.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read your shortlist." };
  }
}

export function saveShortlist(store: KeyValueStore, list: SavedOpportunity[]): void {
  store.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify(list));
}
