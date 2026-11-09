import { CALENDAR_STORAGE_KEY, COMMITMENTS_STORAGE_KEY } from "./calendar/storage";
import { PROFILE_STORAGE_KEY, type KeyValueStore } from "./profileStorage";
import { SHORTLIST_STORAGE_KEY } from "./shortlist";

/** Every localStorage key the app writes. A test checks nothing is missing. */
export const ALL_STORAGE_KEYS = [
  { key: PROFILE_STORAGE_KEY, what: "Your profile: university, program, year, interests, travel and budget preferences, attendance assumptions" },
  { key: CALENDAR_STORAGE_KEY, what: "Imported calendars: their names, coverage dates, import reports, and every event's title and times" },
  { key: COMMITMENTS_STORAGE_KEY, what: "Commitments you entered: classes, exams, assignment due times, work and personal" },
  { key: SHORTLIST_STORAGE_KEY, what: "Your shortlist: saved events, application status, notes, per-event travel times" },
] as const;

export interface DataExport {
  app: "Can I Go?";
  exportedAt: string;
  /** Raw stored values by key (parsed JSON, or the text if it isn't JSON). Missing keys are null. */
  data: Record<string, unknown>;
}

export function exportAllData(store: KeyValueStore, now: Date): DataExport {
  const data: Record<string, unknown> = {};
  for (const { key } of ALL_STORAGE_KEYS) {
    const text = store.getItem(key);
    if (text === null) data[key] = null;
    else {
      try {
        data[key] = JSON.parse(text);
      } catch {
        data[key] = text;
      }
    }
  }
  return { app: "Can I Go?", exportedAt: now.toISOString(), data };
}

export function deleteAllData(store: KeyValueStore): void {
  for (const { key } of ALL_STORAGE_KEYS) store.removeItem(key);
}
