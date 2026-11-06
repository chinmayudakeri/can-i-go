import type { CalendarCoverage, CalendarEvent, CalendarStore, ImportedCalendar, TimedCommitment } from "./types";

export const EMPTY_CALENDAR_STORE: CalendarStore = { calendars: [], events: [] };

/**
 * Adds an import alongside the calendars already there. An event whose key
 * (UID | RECURRENCE-ID | start) is already stored, from this calendar or
 * another, is skipped and counted, so importing the same file twice changes
 * nothing but its coverage record.
 */
export function addImport(
  store: CalendarStore,
  calendar: ImportedCalendar,
  events: CalendarEvent[],
): { store: CalendarStore; added: number; duplicatesSkipped: number } {
  // Re-importing a calendar replaces its own events, so only other calendars count as duplicates.
  const others = store.events.filter((e) => e.calendarId !== calendar.id);
  const known = new Set(others.map((e) => e.key));
  const fresh: CalendarEvent[] = [];
  for (const e of events) {
    if (known.has(e.key)) continue;
    known.add(e.key);
    fresh.push(e);
  }
  return {
    store: {
      calendars: [...store.calendars.filter((c) => c.id !== calendar.id), calendar],
      events: [...others, ...fresh].sort((a, b) => a.start.localeCompare(b.start)),
    },
    added: fresh.length,
    duplicatesSkipped: events.length - fresh.length,
  };
}

/** Removes a calendar and its events. */
export function removeCalendar(store: CalendarStore, calendarId: string): CalendarStore {
  return {
    calendars: store.calendars.filter((c) => c.id !== calendarId),
    events: store.events.filter((e) => e.calendarId !== calendarId),
  };
}

export function coverageOf(store: CalendarStore): CalendarCoverage[] {
  return store.calendars.map((c) => c.coverage);
}

/** Imported events as commitments for the feasibility check. */
export function eventsAsCommitments(store: CalendarStore): TimedCommitment[] {
  const names = new Map(store.calendars.map((c) => [c.id, c.name]));
  return store.events.map((e) => ({
    id: `cal:${e.key}`,
    kind: "calendar",
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    busy: e.busy,
    tentative: e.tentative,
    calendarName: names.get(e.calendarId) ?? null,
  }));
}
