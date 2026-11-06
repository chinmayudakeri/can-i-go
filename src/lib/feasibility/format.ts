/** Plain-language times for feasibility explanations. */

// Intl uses narrow and thin no-break spaces around times and dashes; plain spaces read the same and match in tests.
const plain = (s: string) => s.replace(/[   ]/g, " ");

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function dateFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" });
}

/** "Sat, Nov 14, 9:00 AM EST". */
export function formatMoment(ms: number, timeZone: string): string {
  return plain(timeFormat(timeZone).format(new Date(ms)));
}

/** "Sat, Nov 14, 9:00 – 10:20 AM EST", or both ends in full across days. */
export function formatRange(start: number, end: number, timeZone: string): string {
  return plain(timeFormat(timeZone).formatRange(new Date(start), new Date(end)));
}

/** "Sat, Nov 14" or "Sat, Nov 14 – Sun, Nov 15" for a window whose end is exclusive. */
export function formatDates(start: number, end: number, timeZone: string): string {
  return plain(dateFormat(timeZone).formatRange(new Date(start), new Date(Math.max(start, end - 1))));
}

/** "45 minutes", "3 hours", "1 day 23 hours 59 minutes". */
export function formatDuration(ms: number): string {
  const total = Math.round(Math.abs(ms) / 60_000);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts: [number, string][] = [
    [Math.floor(total / 1440), "day"],
    [Math.floor((total % 1440) / 60), "hour"],
    [total % 60, "minute"],
  ];
  const shown = parts.filter(([n]) => n > 0).map(([n, word]) => unit(n, word));
  return shown.length ? shown.join(" ") : "0 minutes";
}
