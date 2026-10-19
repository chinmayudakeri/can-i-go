/**
 * Minimal iCalendar (RFC 5545) reader: enough for public event feeds.
 * Only VEVENT components are read; nested components (VALARM) are skipped.
 */

export interface IcsDate {
  /** YYYY-MM-DD as written (for UTC values, the UTC date). */
  date: string;
  /** HH:mm as written, or null for all-day values. */
  time: string | null;
  /** TZID parameter, if any. */
  tzid: string | null;
  /** True when the value ends in Z. */
  utc: boolean;
}

export interface IcsEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  start: IcsDate | null;
  end: IcsDate | null;
  status: string | null;
}

export interface IcsCalendar {
  /** X-WR-TIMEZONE, the calendar's default timezone if it declares one. */
  timezone: string | null;
  events: IcsEvent[];
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Property | null {
  // Find the first ":" that isn't inside a quoted parameter value.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function parseDate(prop: Property): IcsDate | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] === undefined ? null : `${m[4]}:${m[5]}`,
    tzid: prop.params.TZID ?? null,
    utc: m[7] === "Z",
  };
}

export function parseIcs(text: string): IcsCalendar {
  const events: IcsEvent[] = [];
  let timezone: string | null = null;
  let current: IcsEvent | null = null;
  let nested = 0;

  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      if (prop.value.toUpperCase() === "VEVENT" && !current) {
        current = { uid: null, summary: null, description: null, location: null, url: null, start: null, end: null, status: null };
      } else if (current) nested++;
      continue;
    }
    if (prop.name === "END") {
      if (current && nested > 0) nested--;
      else if (current && prop.value.toUpperCase() === "VEVENT") {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (!current) {
      if (prop.name === "X-WR-TIMEZONE") timezone = prop.value.trim() || null;
      continue;
    }
    if (nested > 0) continue;
    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim() || null;
        break;
      case "SUMMARY":
        current.summary = unescapeText(prop.value).trim() || null;
        break;
      case "DESCRIPTION":
        current.description = unescapeText(prop.value).trim() || null;
        break;
      case "LOCATION":
        current.location = unescapeText(prop.value).trim() || null;
        break;
      case "URL":
        current.url = prop.value.trim() || null;
        break;
      case "STATUS":
        current.status = prop.value.trim().toUpperCase() || null;
        break;
      case "DTSTART":
        current.start = parseDate(prop);
        break;
      case "DTEND":
        current.end = parseDate(prop);
        break;
    }
  }
  return { timezone, events };
}
