import { parseIcs } from "./parseIcs";
import type { ImportResult } from "./types";

/** Test-only helpers. Fixture files are read by the tests themselves (src/lib can't import Node built-ins). */
export const TEST_NOW = new Date("2026-10-20T12:00:00Z");
export const TEST_TIMEZONE = "America/Toronto";

export function importText(text: string, calendarId: string, note: string | null = null): Extract<ImportResult, { ok: true }> {
  const result = parseIcs(text, { calendarId, calendarName: calendarId, timezone: TEST_TIMEZONE, now: TEST_NOW, note });
  if (!result.ok) throw new Error(`import ${calendarId} failed: ${JSON.stringify(result.report.errors)}`);
  return result;
}
