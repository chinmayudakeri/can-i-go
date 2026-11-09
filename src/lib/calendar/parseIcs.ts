import ICAL from "ical.js";
import { isValidTimeZone } from "../validate";
import { localDateOfMs, nextDate, startOfLocalDateMs, wallTimeToUtcMs } from "../zonedTime";
import type { CalendarCoverage, CalendarEvent, ImportCounts, ImportIssue, ImportReport, ImportResult } from "./types";

/**
 * Reads an .ics file in the browser with ical.js (RFC 5545: RRULE, RDATE,
 * EXDATE, RECURRENCE-ID, VTIMEZONE). Nothing is uploaded. Anything we can't
 * read or don't support goes in the import report; nothing is dropped silently.
 */

export const MAX_ICS_BYTES = 2 * 1024 * 1024;
/** Occurrences kept per import after recurrence expansion. More than this rejects the file. */
export const MAX_OCCURRENCES = 10_000;
/** Steps through one recurrence rule before we give up on it. */
const MAX_ITERATIONS_PER_EVENT = 50_000;
/** Issues listed per code before the rest are summarized. */
const MAX_ISSUES_PER_CODE = 20;
const DAY_MS = 86_400_000;

export interface ParseIcsOptions {
  calendarId: string;
  calendarName: string;
  /** The student's IANA timezone: floating times and all-day dates are read in it, and coverage dates use it. */
  timezone: string;
  /** Optional note about what this calendar holds, kept with its coverage. */
  note?: string | null;
  now: Date;
  /** Occurrences ending before now minus this many days are skipped. Default 31. */
  pastDays?: number;
  /** Occurrences starting after now plus this many days are skipped. Default 400. */
  futureDays?: number;
}

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;

class IssueList {
  readonly items: ImportIssue[] = [];
  private readonly overflow = new Map<ImportIssue["code"], number>();
  private readonly perCode = new Map<ImportIssue["code"], number>();

  add(issue: ImportIssue): void {
    const n = (this.perCode.get(issue.code) ?? 0) + 1;
    this.perCode.set(issue.code, n);
    if (n <= MAX_ISSUES_PER_CODE) this.items.push(issue);
    else this.overflow.set(issue.code, (this.overflow.get(issue.code) ?? 0) + 1);
  }

  finish(): ImportIssue[] {
    for (const [code, n] of this.overflow) this.items.push({ code, message: `…and ${n} more like this.` });
    return this.items;
  }
}

function label(summary: string | null): string {
  return summary ? `"${summary}"` : "an untitled event";
}

type ReadTime = { ok: true; ms: number; basis: CalendarEvent["timeBasis"] } | { ok: false; issue: ImportIssue };

/** `tzid` is the property's TZID parameter, if any. */
function readTime(t: Time | null | undefined, tzid: string | null, timezone: string, what: string, summary: string | null): ReadTime {
  const parts = t ? [t.year, t.month, t.day, t.hour, t.minute, t.second] : [];
  const valid =
    t instanceof ICAL.Time &&
    parts.every(Number.isFinite) &&
    t.month >= 1 &&
    t.month <= 12 &&
    t.day >= 1 &&
    t.day <= ICAL.Time.daysInMonth(t.month, t.year);
  if (!t || !valid) return { ok: false, issue: { code: "bad-event", message: `${label(summary)} has an unreadable ${what}.`, summary: summary ?? undefined } };

  if (t.isDate) {
    const date = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    return { ok: true, ms: startOfLocalDateMs(date, timezone), basis: "date" };
  }
  const zone = t.zone?.tzid;
  if (t.zone === ICAL.Timezone.utcTimezone || zone === "UTC") return { ok: true, ms: t.toUnixTime() * 1000, basis: "utc" };
  // ical.js resolves a TZID against the file's own VTIMEZONE blocks; otherwise the time stays "floating".
  if (zone && zone !== "floating") return { ok: true, ms: t.toUnixTime() * 1000, basis: "vtimezone" };

  const wall = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second };
  const named = tzid;
  if (named) {
    if (!isValidTimeZone(named)) {
      return {
        ok: false,
        issue: {
          code: "unknown-timezone",
          message: `${label(summary)} uses the timezone "${named}", which the file doesn't define and isn't a standard name, so we couldn't place it.`,
          summary: summary ?? undefined,
        },
      };
    }
    return { ok: true, ms: wallTimeToUtcMs(wall, named), basis: "iana" };
  }
  return { ok: true, ms: wallTimeToUtcMs(wall, timezone), basis: "floating" };
}

const SUPPORTED_COMPONENTS = new Set(["vevent", "vtimezone"]);
const COMPONENT_NAMES: Record<string, string> = { vtodo: "to-do item", vjournal: "journal entry", vfreebusy: "free/busy block", valarm: "alarm" };

/** The rejection for a file over MAX_ICS_BYTES, so the browser can refuse it before reading it. */
export function tooLargeResult(bytes: number, calendarName: string): ImportResult {
  return {
    ok: false,
    report: {
      ok: false,
      calendarName,
      errors: [
        {
          code: "too-large",
          message: `This file is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_ICS_BYTES / 1024 / 1024} MB; try exporting a shorter date range.`,
        },
      ],
      warnings: [],
      counts: { components: 0, occurrences: 0, cancelled: 0, transparent: 0, duplicates: 0, unreadable: 0 },
    },
  };
}

export function parseIcs(text: string, options: ParseIcsOptions): ImportResult {
  const { calendarId, calendarName, timezone, now } = options;
  const errors = new IssueList();
  const warnings = new IssueList();
  const counts: ImportCounts = { components: 0, occurrences: 0, cancelled: 0, transparent: 0, duplicates: 0, unreadable: 0 };
  const report = (ok: boolean): ImportReport => ({ ok, calendarName, errors: errors.finish(), warnings: warnings.finish(), counts });
  const fail = (issue: ImportIssue): ImportResult => {
    errors.add(issue);
    return { ok: false, report: report(false) };
  };

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_ICS_BYTES) return tooLargeResult(bytes, calendarName);

  let roots: Component[];
  try {
    const parsed = ICAL.parse(text) as unknown[];
    const list = Array.isArray(parsed[0]) ? (parsed as unknown[][]) : [parsed];
    roots = list.map((jcal) => new ICAL.Component(jcal as never));
  } catch (e) {
    return fail({ code: "malformed", message: `This isn't a readable .ics file (${e instanceof Error ? e.message : "parse error"}).` });
  }
  if (roots.length === 0 || roots.some((r) => r.name !== "vcalendar")) {
    return fail({ code: "not-a-calendar", message: "This file doesn't contain a calendar (no BEGIN:VCALENDAR)." });
  }

  const windowStart = now.getTime() - (options.pastDays ?? 31) * DAY_MS;
  const windowEnd = now.getTime() + (options.futureDays ?? 400) * DAY_MS;

  const unsupported = new Map<string, number>();
  const vevents: Component[] = [];
  for (const root of roots) {
    for (const sub of root.getAllSubcomponents()) {
      if (sub.name === "vevent") vevents.push(sub);
      else if (!SUPPORTED_COMPONENTS.has(sub.name)) unsupported.set(sub.name, (unsupported.get(sub.name) ?? 0) + 1);
    }
  }
  for (const [name, n] of unsupported) {
    warnings.add({ code: "unsupported-component", message: `Ignored ${n} ${COMPONENT_NAMES[name] ?? name.toUpperCase()}${n === 1 ? "" : "s"}: only events are read.` });
  }
  counts.components = vevents.length;

  // Group overrides (RECURRENCE-ID) with their series by UID.
  const masters = new Map<string, Component>();
  const overrides = new Map<string, Component[]>();
  const standalone: Component[] = [];
  let missingUid = 0;
  for (const v of vevents) {
    const uid = v.getFirstPropertyValue("uid");
    if (typeof uid !== "string" || !uid.trim()) {
      missingUid++;
      standalone.push(v);
    } else if (v.hasProperty("recurrence-id")) {
      overrides.set(uid, [...(overrides.get(uid) ?? []), v]);
    } else if (masters.has(uid)) {
      warnings.add({ code: "bad-event", message: `Two events share the ID ${uid}; both were kept.`, uid });
      standalone.push(v);
    } else {
      masters.set(uid, v);
    }
  }
  if (missingUid) {
    warnings.add({ code: "missing-uid", message: `${missingUid} event${missingUid === 1 ? " has" : "s have"} no UID, so re-importing may not spot ${missingUid === 1 ? "it" : "them"} as duplicates.` });
  }
  // Overrides whose series isn't in the file are read as one-off events.
  for (const [uid, list] of overrides) if (!masters.has(uid)) standalone.push(...list);

  const events: CalendarEvent[] = [];
  const keys = new Set<string>();
  let outside = 0;
  let openEnded = 0;
  let tooMany = false;
  let floating = 0;

  const addOccurrence = (args: {
    uid: string | null;
    item: InstanceType<typeof ICAL.Event>;
    start: Time;
    end: Time | null;
    recurrenceId: string;
  }): void => {
    const { uid, item } = args;
    const summary = item.summary || null;
    const status = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    if (status === "CANCELLED") {
      counts.cancelled++;
      return;
    }
    const tzidOf = (name: string): string | null => {
      const value = item.component.getFirstProperty(name)?.getParameter("tzid");
      return typeof value === "string" ? value : null;
    };
    const startTzid = tzidOf("dtstart");
    const start = readTime(args.start, startTzid, timezone, "start time", summary);
    if (!start.ok) {
      counts.unreadable++;
      errors.add({ ...start.issue, uid: uid ?? undefined });
      return;
    }
    let endMs: number;
    if (args.end && !(args.end.compare(args.start) === 0 && args.start.isDate)) {
      const end = readTime(args.end, item.component.hasProperty("dtend") ? tzidOf("dtend") : startTzid, timezone, "end time", summary);
      if (!end.ok) {
        counts.unreadable++;
        errors.add({ ...end.issue, uid: uid ?? undefined });
        return;
      }
      endMs = end.ms;
    } else {
      // RFC 5545: a date with no end lasts one day; a date-time with no end is a moment.
      endMs = args.start.isDate ? startOfLocalDateMs(nextDate(localDateOfMs(start.ms, timezone)), timezone) : start.ms;
    }
    if (endMs < start.ms) {
      counts.unreadable++;
      errors.add({ code: "bad-event", message: `${label(summary)} ends before it starts.`, uid: uid ?? undefined, summary: summary ?? undefined });
      return;
    }
    if (endMs <= windowStart || start.ms > windowEnd) {
      outside++;
      return;
    }
    const startIso = new Date(start.ms).toISOString();
    const key = `${uid ?? `nouid:${summary ?? ""}`}|${args.recurrenceId}|${startIso}`;
    if (keys.has(key)) {
      counts.duplicates++;
      return;
    }
    if (events.length >= MAX_OCCURRENCES) {
      tooMany = true;
      return;
    }
    keys.add(key);
    const busy = String(item.component.getFirstPropertyValue("transp") ?? "OPAQUE").toUpperCase() !== "TRANSPARENT";
    if (!busy) counts.transparent++;
    if (start.basis === "floating") floating++;
    events.push({
      key,
      calendarId,
      uid,
      title: summary ?? "(untitled event)",
      start: startIso,
      end: new Date(endMs).toISOString(),
      allDay: start.basis === "date",
      busy,
      tentative: status === "TENTATIVE",
      timeBasis: start.basis,
    });
  };

  const readComponent = (v: Component, overridesForUid: Component[]): void => {
    const uidValue = v.getFirstPropertyValue("uid");
    const uid = typeof uidValue === "string" && uidValue.trim() ? uidValue : null;
    let event: InstanceType<typeof ICAL.Event>;
    try {
      event = new ICAL.Event(v);
    } catch (e) {
      counts.unreadable++;
      errors.add({ code: "bad-event", message: `An event couldn't be read (${e instanceof Error ? e.message : "error"}).`, uid: uid ?? undefined });
      return;
    }
    const summary = event.summary || null;
    if (!v.hasProperty("dtstart")) {
      counts.unreadable++;
      errors.add({ code: "bad-event", message: `${label(summary)} has no start time.`, uid: uid ?? undefined, summary: summary ?? undefined });
      return;
    }
    if (v.hasProperty("exrule")) {
      warnings.add({
        code: "unsupported-property",
        message: `${label(summary)} uses EXRULE, which isn't supported: dates it would remove are still treated as busy.`,
        uid: uid ?? undefined,
        summary: summary ?? undefined,
      });
    }

    if (!event.isRecurring()) {
      const rid = v.getFirstPropertyValue("recurrence-id");
      addOccurrence({ uid, item: event, start: event.startDate, end: event.endDate, recurrenceId: rid ? String(rid) : "" });
      return;
    }

    for (const o of overridesForUid) {
      try {
        event.relateException(o);
      } catch {
        counts.unreadable++;
        errors.add({ code: "bad-event", message: `A changed occurrence of ${label(summary)} couldn't be read.`, uid: uid ?? undefined });
      }
    }
    const rules = v.getAllProperties("rrule").map((p) => p.getFirstValue() as InstanceType<typeof ICAL.Recur>);
    const endless = rules.some((r) => !r.until && !r.count);

    let iterator: ReturnType<typeof event.iterator>;
    try {
      iterator = event.iterator();
    } catch (e) {
      counts.unreadable++;
      errors.add({ code: "bad-event", message: `The repeat rule of ${label(summary)} couldn't be read (${e instanceof Error ? e.message : "error"}).`, uid: uid ?? undefined });
      return;
    }
    let steps = 0;
    for (;;) {
      let next: Time | null | undefined;
      try {
        next = iterator.next();
      } catch (e) {
        counts.unreadable++;
        errors.add({ code: "bad-event", message: `The repeat rule of ${label(summary)} couldn't be read (${e instanceof Error ? e.message : "error"}).`, uid: uid ?? undefined });
        return;
      }
      if (!next) break;
      if (++steps > MAX_ITERATIONS_PER_EVENT) {
        counts.unreadable++;
        errors.add({ code: "bad-event", message: `${label(summary)} repeats too often to read; later occurrences are missing.`, uid: uid ?? undefined, summary: summary ?? undefined });
        return;
      }
      // Stop well past the window (overrides can move an occurrence later than its slot).
      if (next.toUnixTime() * 1000 > windowEnd + 7 * DAY_MS) break;
      const details = event.getOccurrenceDetails(next);
      addOccurrence({ uid, item: details.item, start: details.startDate, end: details.endDate, recurrenceId: details.recurrenceId.toString() });
      if (tooMany) return;
    }
    if (endless) openEnded++;
  };

  // ical.js decodes values lazily and throws on bad ones, so each event is read on its own.
  const readSafely = (v: Component, overridesForUid: Component[]): void => {
    const before = events.length;
    try {
      readComponent(v, overridesForUid);
    } catch (e) {
      for (const dropped of events.splice(before)) keys.delete(dropped.key);
      counts.unreadable++;
      const summary = v.getFirstPropertyValue("summary");
      const name = typeof summary === "string" && summary ? summary : null;
      const uid = v.getFirstPropertyValue("uid");
      errors.add({
        code: "bad-event",
        message: `${label(name)} couldn't be read (${e instanceof Error ? e.message : "error"}).`,
        uid: typeof uid === "string" ? uid : undefined,
        summary: name ?? undefined,
      });
    }
  };
  for (const [uid, master] of masters) {
    readSafely(master, overrides.get(uid) ?? []);
    if (tooMany) break;
  }
  if (!tooMany) for (const v of standalone) readSafely(v, []);

  if (tooMany) {
    return fail({
      code: "too-many-occurrences",
      message: `This calendar has more than ${MAX_OCCURRENCES.toLocaleString("en-US")} events in the next ${options.futureDays ?? 400} days. Try exporting fewer calendars or a shorter range.`,
    });
  }
  if (floating) {
    warnings.add({ code: "floating-time", message: `${floating} event time${floating === 1 ? " has" : "s have"} no timezone, so ${floating === 1 ? "it was" : "they were"} read as ${timezone} time.` });
  }
  if (openEnded) {
    warnings.add({
      code: "open-ended-recurrence",
      message: `${openEnded} repeating event${openEnded === 1 ? " has" : "s have"} no end date; included up to ${localDateOfMs(windowEnd, timezone)}.`,
    });
  }
  if (outside) {
    warnings.add({
      code: "outside-window",
      message: `${outside} event${outside === 1 ? "" : "s"} outside ${localDateOfMs(windowStart, timezone)} to ${localDateOfMs(windowEnd, timezone)} ${outside === 1 ? "was" : "were"} skipped.`,
    });
  }
  counts.occurrences = events.length;

  const coverage = coverageOf(events, options);
  if (!coverage.from) warnings.add({ code: "empty", message: "No events were found, so this calendar doesn't cover any dates." });
  events.sort((a, b) => a.start.localeCompare(b.start));
  const finalReport = report(true);
  coverage.unreadableEvents = counts.unreadable;
  return {
    ok: true,
    events,
    report: finalReport,
    calendar: { id: calendarId, name: calendarName, importedAt: now.toISOString(), coverage, report: finalReport },
  };
}

/** Earliest event start to latest event end, as local dates. Cancelled events aren't in `events`. */
function coverageOf(events: CalendarEvent[], options: ParseIcsOptions): CalendarCoverage {
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    first = Math.min(first, Date.parse(e.start));
    // An end at exactly midnight belongs to the previous day.
    last = Math.max(last, Math.max(Date.parse(e.start), Date.parse(e.end) - 1));
  }
  const note = options.note?.trim() || null;
  return {
    calendarId: options.calendarId,
    calendarName: options.calendarName,
    from: events.length ? localDateOfMs(first, options.timezone) : null,
    until: events.length ? localDateOfMs(last, options.timezone) : null,
    timezone: options.timezone,
    note,
    unreadableEvents: 0,
  };
}
