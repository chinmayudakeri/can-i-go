import type { KeyValueStore } from "../profileStorage";
import { parseManualCommitment } from "./commitments";
import { EMPTY_CALENDAR_STORE } from "./store";
import type { CalendarEvent, CalendarStore, Commitment, ImportedCalendar } from "./types";

/**
 * Calendar imports and manual commitments live only in this browser's
 * localStorage. Nothing here talks to a server.
 */
export const CALENDAR_STORAGE_KEY = "can-i-go.calendar.v1";
export const COMMITMENTS_STORAGE_KEY = "can-i-go.commitments.v1";

export type Loaded<T> = { ok: true; value: T; dropped: number } | { ok: false; error: string };

const isText = (v: unknown): v is string => typeof v === "string";

function isEvent(v: unknown): v is CalendarEvent {
  const e = v as Record<string, unknown>;
  return (
    !!e &&
    [e.key, e.calendarId, e.title, e.start, e.end].every(isText) &&
    !Number.isNaN(Date.parse(e.start as string)) &&
    !Number.isNaN(Date.parse(e.end as string)) &&
    typeof e.allDay === "boolean" &&
    typeof e.busy === "boolean"
  );
}

function isCalendar(v: unknown): v is ImportedCalendar {
  const c = v as Record<string, unknown>;
  const cov = c?.coverage as Record<string, unknown> | undefined;
  return !!c && isText(c.id) && isText(c.name) && !!cov && (cov.from === null || isText(cov.from)) && (cov.until === null || isText(cov.until));
}

function read(store: KeyValueStore, key: string): { ok: true; raw: unknown } | { ok: false; error: string } {
  try {
    const text = store.getItem(key);
    return { ok: true, raw: text === null ? null : JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read saved calendar data." };
  }
}

/** Loads saved calendars. Malformed entries are dropped and counted so the UI can say so. */
export function loadCalendarStore(store: KeyValueStore): Loaded<CalendarStore> {
  const r = read(store, CALENDAR_STORAGE_KEY);
  if (!r.ok) return r;
  if (r.raw === null) return { ok: true, value: EMPTY_CALENDAR_STORE, dropped: 0 };
  const raw = r.raw as Record<string, unknown>;
  const calendars = Array.isArray(raw?.calendars) ? raw.calendars : [];
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const goodCalendars = calendars.filter(isCalendar);
  const ids = new Set(goodCalendars.map((c) => c.id));
  // An event without its calendar has no coverage record, so it can't be trusted either.
  const goodEvents = events.filter((e): e is CalendarEvent => isEvent(e) && ids.has(e.calendarId));
  return {
    ok: true,
    value: { calendars: goodCalendars, events: goodEvents },
    dropped: calendars.length - goodCalendars.length + events.length - goodEvents.length,
  };
}

export function saveCalendarStore(store: KeyValueStore, value: CalendarStore): void {
  store.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(value));
}

export function loadCommitments(store: KeyValueStore): Loaded<Commitment[]> {
  const r = read(store, COMMITMENTS_STORAGE_KEY);
  if (!r.ok) return r;
  const list = Array.isArray(r.raw) ? r.raw : [];
  const good = list.map(parseManualCommitment).flatMap((c) => (c.ok ? [c.commitment] : []));
  return { ok: true, value: good, dropped: list.length - good.length };
}

export function saveCommitments(store: KeyValueStore, value: Commitment[]): void {
  store.setItem(COMMITMENTS_STORAGE_KEY, JSON.stringify(value));
}

/** Deletes every saved calendar and commitment. */
export function deleteCalendarData(store: KeyValueStore): void {
  store.removeItem(CALENDAR_STORAGE_KEY);
  store.removeItem(COMMITMENTS_STORAGE_KEY);
}
