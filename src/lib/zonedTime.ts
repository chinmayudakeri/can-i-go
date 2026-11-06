/**
 * Deterministic wall-clock ⇄ UTC conversions with Intl (DST-aware). Kept in
 * src/lib so browser code never needs src/ingest.
 */

// Building an Intl.DateTimeFormat is slow, and recurrence expansion converts thousands of times.
const formats = new Map<string, Intl.DateTimeFormat>();
function cached(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = formats.get(key);
  if (!f) formats.set(key, (f = make()));
  return f;
}

function offsetMinutes(timeZone: string, utcMs: number): number {
  const name =
    cached(`offset|${timeZone}`, () => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }))
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

export interface WallTime {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Wall-clock time in `timeZone` → UTC milliseconds. A time skipped by a DST
 * jump lands just after the jump; a repeated time takes the first (earlier)
 * occurrence.
 */
export function wallTimeToUtcMs(t: WallTime, timeZone: string): number {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const DAY = 86_400_000;
  // Offsets in effect around this date; at most two differ near a DST change.
  const before = offsetMinutes(timeZone, wall - DAY);
  const offsets = new Set([before, offsetMinutes(timeZone, wall), offsetMinutes(timeZone, wall + DAY)]);
  const valid = [...offsets].map((o) => wall - o * 60_000).filter((utc) => wall - offsetMinutes(timeZone, utc) * 60_000 === utc);
  // Repeated hour: the earlier instant. Skipped hour: read with the offset from before the jump (RFC 5545 §3.3.5).
  return valid.length ? Math.min(...valid) : wall - before * 60_000;
}

/** Midnight at the start of a YYYY-MM-DD date in `timeZone`, as UTC milliseconds. */
export function startOfLocalDateMs(date: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return wallTimeToUtcMs({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** YYYY-MM-DD of an instant in `timeZone`. */
export function localDateOfMs(utcMs: number, timeZone: string): string {
  return cached(`date|${timeZone}`, () => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })).format(
    new Date(utcMs),
  );
}

/** HH:mm:ss (24h) of an instant in `timeZone`. */
export function localTimeOfMs(utcMs: number, timeZone: string): string {
  return cached(`time|${timeZone}`, () => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })).format(
    new Date(utcMs),
  );
}

/** The next calendar date after YYYY-MM-DD. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD from `first` to `last`, inclusive. */
export function datesBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = nextDate(d)) out.push(d);
  return out;
}
