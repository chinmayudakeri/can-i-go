import { eventHoursUnknown } from "../feasibility/attendance";
import type { Opportunity } from "../types";
import { localDateOfMs, nextDate } from "../zonedTime";

/**
 * Builds an .ics file of shortlisted events in the browser (RFC 5545).
 * Attendance is timed events (one per session when a schedule is published).
 * Application deadlines are separate entries: a point in time when the cutoff
 * is known, an all-day entry when only the date is. Deadlines are marked
 * transparent because they aren't time you're busy.
 */

const CRLF = "\r\n";

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function basicDate(date: string): string {
  return date.replace(/-/g, "");
}

function placeText(o: Opportunity): string {
  if (o.format === "online" || !o.location) return "Online";
  const parts = [o.location.venue, o.location.city, o.location.region, o.location.country].filter(Boolean).join(", ");
  return o.format === "hybrid" ? `${parts} (or online)` : parts;
}

interface Entry {
  uid: string;
  summary: string;
  start: { ms: number } | { date: string };
  end: { ms: number } | { date: string };
  transparent: boolean;
  description: string;
  location: string | null;
  url: string;
}

function entriesFor(o: Opportunity): Entry[] {
  const demo = o.dataset !== "real";
  const prefix = demo ? "[DEMO] " : "";
  const description = [
    demo ? "DEMO: this event is fictional." : null,
    `Official page: ${o.officialUrl}`,
    o.applyUrl ? `Apply: ${o.applyUrl}` : null,
    `Source: ${o.sourceUrl} (last verified ${o.lastVerified})`,
    "Exported from Can I Go? Check the official page before you travel.",
  ]
    .filter(Boolean)
    .join("\n");
  const base = { description, location: placeText(o), url: o.officialUrl, transparent: false };
  const uid = (suffix: string) => `${o.id}-${suffix}@can-i-go`;
  const entries: Entry[] = [];

  if (o.attendanceSessions?.length) {
    o.attendanceSessions.forEach((s, i) => {
      const optional = s.mandatory === false ? " (optional)" : "";
      entries.push({
        ...base,
        uid: uid(`session-${i}`),
        summary: `${prefix}${o.name}: ${s.label ?? `Session ${i + 1}`}${optional}`,
        start: { ms: Date.parse(s.start) },
        end: { ms: Date.parse(s.end) },
      });
    });
  } else if (eventHoursUnknown(o)) {
    entries.push({
      ...base,
      uid: uid("attend"),
      summary: `${prefix}${o.name} (hours not published)`,
      start: { date: localDateOfMs(Date.parse(o.start), o.timezone) },
      end: { date: nextDate(localDateOfMs(Date.parse(o.end), o.timezone)) },
    });
  } else {
    entries.push({ ...base, uid: uid("attend"), summary: `${prefix}${o.name}`, start: { ms: Date.parse(o.start) }, end: { ms: Date.parse(o.end) } });
  }

  if (o.applicationDeadline) {
    const due = Date.parse(o.applicationDeadline);
    if (o.exactCutoffUnknown) {
      const date = localDateOfMs(due, o.timezone);
      entries.push({
        ...base,
        uid: uid("deadline"),
        summary: `${prefix}Apply by: ${o.name} (exact time not published)`,
        start: { date },
        end: { date: nextDate(date) },
        transparent: true,
        location: null,
      });
    } else {
      entries.push({ ...base, uid: uid("deadline"), summary: `${prefix}Application deadline: ${o.name}`, start: { ms: due }, end: { ms: due }, transparent: true, location: null });
    }
  }
  return entries;
}

export function exportShortlistIcs(opportunities: Opportunity[], now: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Can I Go//Shortlist export//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Can I Go? shortlist"];
  const stamp = utc(now.getTime());
  for (const o of opportunities) {
    for (const e of entriesFor(o)) {
      const time = (name: string, t: Entry["start"]) => ("ms" in t ? `${name}:${utc(t.ms)}` : `${name};VALUE=DATE:${basicDate(t.date)}`);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.uid}`,
        `DTSTAMP:${stamp}`,
        time("DTSTART", e.start),
        time("DTEND", e.end),
        `SUMMARY:${escapeText(e.summary)}`,
        `DESCRIPTION:${escapeText(e.description)}`,
        ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
        `URL:${e.url}`,
        `TRANSP:${e.transparent ? "TRANSPARENT" : "OPAQUE"}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}
