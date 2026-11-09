"use client";

import { useCallback, useEffect, useState } from "react";
import { CALENDAR_TOGGLE_STORAGE_KEY, loadCalendarEnabled, saveCalendarEnabled } from "@/lib/calendarToggle";

/** Same-tab signal: the storage event only reaches other tabs. */
const CHANGED = "can-i-go:use-calendar-changed";

export function notifyCalendarToggleChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The "Use my calendar" switch, kept in sync across components and tabs. Off until read. */
export function useCalendarEnabled() {
  const [state, setState] = useState({ ready: false, enabled: false });

  useEffect(() => {
    const read = () => setState({ ready: true, enabled: loadCalendarEnabled(window.localStorage) });
    read();
    const onStorage = (e: StorageEvent) => (e.key === null || e.key === CALENDAR_TOGGLE_STORAGE_KEY) && read();
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED, read);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED, read);
    };
  }, []);

  /** Saves the choice. Only the switch changes; calendar data is never touched. Returns an error message or null. */
  const setEnabled = useCallback((enabled: boolean): string | null => {
    try {
      saveCalendarEnabled(window.localStorage, enabled);
    } catch (e) {
      return `Couldn't save this setting: ${e instanceof Error ? e.message : "storage error"}`;
    }
    notifyCalendarToggleChanged();
    return null;
  }, []);

  return { ...state, setEnabled };
}
