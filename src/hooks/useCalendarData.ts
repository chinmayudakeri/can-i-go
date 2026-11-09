"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALENDAR_STORAGE_KEY,
  COMMITMENTS_STORAGE_KEY,
  deleteCalendarData,
  loadCalendarStore,
  loadCommitments,
  saveCalendarStore,
  saveCommitments,
} from "@/lib/calendar/storage";
import { addImport, EMPTY_CALENDAR_STORE, removeCalendar } from "@/lib/calendar/store";
import type { CalendarEvent, CalendarStore, Commitment, ImportedCalendar } from "@/lib/calendar/types";

export type CalendarDataState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; store: CalendarStore; commitments: Commitment[]; dropped: number };

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Imported calendars and manual commitments from this browser's localStorage.
 * Actions return an error message when saving fails (e.g. storage full), or null.
 */
export function useCalendarData() {
  const [state, setState] = useState<CalendarDataState>({ status: "loading" });

  const refresh = useCallback(() => {
    try {
      const store = loadCalendarStore(window.localStorage);
      const commitments = loadCommitments(window.localStorage);
      if (!store.ok) return setState({ status: "error", error: store.error });
      if (!commitments.ok) return setState({ status: "error", error: commitments.error });
      setState({ status: "ready", store: store.value, commitments: commitments.value, dropped: store.dropped + commitments.dropped });
    } catch (e) {
      setState({ status: "error", error: message(e, "Storage unavailable") });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => (e.key === null || e.key === CALENDAR_STORAGE_KEY || e.key === COMMITMENTS_STORAGE_KEY) && refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  // Actions read the latest saved data from a ref, so back-to-back actions (importing several
  // files in one go) build on each other instead of on a stale render.
  const latest = useRef<{ store: CalendarStore; commitments: Commitment[] }>({ store: EMPTY_CALENDAR_STORE, commitments: [] });
  if (state.status === "ready") latest.current = { store: state.store, commitments: state.commitments };

  const write = useCallback((next: { store: CalendarStore; commitments: Commitment[] }): string | null => {
    try {
      if (next.store !== latest.current.store) saveCalendarStore(window.localStorage, next.store);
      if (next.commitments !== latest.current.commitments) saveCommitments(window.localStorage, next.commitments);
    } catch (e) {
      return `Couldn't save to this browser: ${message(e, "storage error")}`;
    }
    latest.current = next;
    setState({ status: "ready", ...next, dropped: 0 });
    return null;
  }, []);

  /** Adds a calendar, or replaces one with the same id (reimport). */
  const importCalendar = useCallback(
    (calendar: ImportedCalendar, events: CalendarEvent[]) => {
      const result = addImport(latest.current.store, calendar, events);
      return { error: write({ ...latest.current, store: result.store }), added: result.added, duplicatesSkipped: result.duplicatesSkipped };
    },
    [write],
  );

  const disconnect = useCallback((calendarId: string) => write({ ...latest.current, store: removeCalendar(latest.current.store, calendarId) }), [write]);

  const addCommitment = useCallback((c: Commitment) => write({ ...latest.current, commitments: [...latest.current.commitments, c] }), [write]);

  const removeCommitment = useCallback(
    (id: string) => write({ ...latest.current, commitments: latest.current.commitments.filter((c) => c.id !== id) }),
    [write],
  );

  const deleteAll = useCallback((): string | null => {
    try {
      deleteCalendarData(window.localStorage);
    } catch (e) {
      return message(e, "Could not delete.");
    }
    latest.current = { store: EMPTY_CALENDAR_STORE, commitments: [] };
    setState({ status: "ready", store: EMPTY_CALENDAR_STORE, commitments: [], dropped: 0 });
    return null;
  }, []);

  return { state, importCalendar, disconnect, addCommitment, removeCommitment, deleteAll, refresh };
}
