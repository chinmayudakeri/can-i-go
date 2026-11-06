/**
 * Calendar data. All of it is parsed and kept in the browser; none of it is
 * ever sent to a server.
 */

/** Kinds a student can enter by hand. */
export const MANUAL_COMMITMENT_KINDS = ["class", "exam", "assignment", "work", "personal"] as const;
export type ManualCommitmentKind = (typeof MANUAL_COMMITMENT_KINDS)[number];

/** Occupied time: from a calendar import ("calendar") or entered by hand. */
export interface TimedCommitment {
  id: string;
  kind: Exclude<ManualCommitmentKind, "assignment"> | "calendar";
  title: string;
  /** ISO 8601 (UTC). */
  start: string;
  end: string;
  allDay: boolean;
  /** False for TRANSP:TRANSPARENT ("show as free"): listed, but never blocks time. */
  busy: boolean;
  tentative: boolean;
  /** Calendar name for imported events, null for manual ones. */
  calendarName: string | null;
}

/** An assignment deadline: a point in time, not a block of occupied time. */
export interface DeadlineCommitment {
  id: string;
  kind: "assignment";
  title: string;
  /** ISO 8601. */
  due: string;
}

export type Commitment = TimedCommitment | DeadlineCommitment;

/** One occurrence from an imported calendar. */
export interface CalendarEvent {
  /** Stable across re-imports: UID | RECURRENCE-ID | start (UTC). */
  key: string;
  calendarId: string;
  uid: string | null;
  title: string;
  /** ISO 8601 (UTC). For all-day events, local midnight in the import timezone. */
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  tentative: boolean;
  /** How the time was read: from UTC, the file's VTIMEZONE, an IANA TZID, or floating (read in the import timezone). */
  timeBasis: "utc" | "vtimezone" | "iana" | "floating" | "date";
}

/**
 * The dates an import actually covers: earliest to latest event, inclusive,
 * in `timezone`. Dates outside every coverage range are never reported free.
 */
export interface CalendarCoverage {
  calendarId: string;
  calendarName: string;
  /** YYYY-MM-DD, or null when the import has no events (it covers nothing). */
  from: string | null;
  until: string | null;
  timezone: string;
  /** The user's own note, e.g. "Fall term classes only". */
  note: string | null;
  /** Events we couldn't read; free time inside this range may be wrong when > 0. */
  unreadableEvents: number;
}

export interface ImportIssue {
  code:
    | "too-large"
    | "malformed"
    | "not-a-calendar"
    | "bad-event"
    | "unknown-timezone"
    | "floating-time"
    | "unsupported-component"
    | "unsupported-property"
    | "open-ended-recurrence"
    | "too-many-occurrences"
    | "missing-uid"
    | "outside-window"
    | "empty";
  message: string;
  uid?: string;
  summary?: string;
}

export interface ImportCounts {
  /** VEVENT components in the file. */
  components: number;
  /** Occurrences kept (after recurrence expansion). */
  occurrences: number;
  cancelled: number;
  transparent: number;
  /** Same key seen twice in this file. */
  duplicates: number;
  /** Events we couldn't read (listed in errors). */
  unreadable: number;
}

export interface ImportReport {
  ok: boolean;
  calendarName: string;
  /** Problems that lost information: the file or an event couldn't be read. */
  errors: ImportIssue[];
  /** Things to know: assumptions we made, content we don't support. */
  warnings: ImportIssue[];
  counts: ImportCounts;
}

export interface ImportedCalendar {
  id: string;
  name: string;
  /** ISO 8601. */
  importedAt: string;
  coverage: CalendarCoverage;
  report: ImportReport;
}

export type ImportResult =
  | { ok: true; calendar: ImportedCalendar; events: CalendarEvent[]; report: ImportReport }
  | { ok: false; report: ImportReport };

export interface CalendarStore {
  calendars: ImportedCalendar[];
  events: CalendarEvent[];
}
