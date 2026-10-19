/** Deterministic timezone conversions (Intl only, no guessing). */

function offsetMinutes(timeZone: string, utcMs: number): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Local wall-clock time in `timeZone` → ISO 8601 with the correct offset for
 * that date (DST-aware). `time` is "HH:mm" or "HH:mm:ss".
 */
export function localToIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let offset = offsetMinutes(timeZone, wall);
  const second = offsetMinutes(timeZone, wall - offset * 60_000);
  if (second !== offset) offset = second;
  const hhmmss = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${date}T${hhmmss}${formatOffset(offset)}`;
}

/** A UTC instant → local date and HH:mm in `timeZone`. */
export function utcToLocal(utcMs: number, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The calendar date (YYYY-MM-DD) of an instant in Waterloo, used for lastVerified. */
export function waterlooDate(iso: string): string {
  return utcToLocal(Date.parse(iso), "America/Toronto").date;
}
