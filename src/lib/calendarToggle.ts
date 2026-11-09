import type { KeyValueStore } from "./profileStorage";

/**
 * The "Use my calendar" switch. Off by default: nothing about calendars or
 * attendance is shown, and the feasibility engine doesn't run. Turning it off
 * never deletes calendar data; only the Privacy page (or the Calendar page's
 * delete button) does.
 */
export const CALENDAR_TOGGLE_STORAGE_KEY = "can-i-go.use-calendar.v1";

/** False unless the student switched it on. Unreadable storage counts as off. */
export function loadCalendarEnabled(store: KeyValueStore): boolean {
  try {
    return store.getItem(CALENDAR_TOGGLE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveCalendarEnabled(store: KeyValueStore, enabled: boolean): void {
  store.setItem(CALENDAR_TOGGLE_STORAGE_KEY, enabled ? "true" : "false");
}
