import { describe, expect, it } from "vitest";
import { makeOpportunity } from "../testFixtures";
import { exportShortlistIcs } from "./exportIcs";
import { parseIcs } from "./parseIcs";

const NOW = new Date("2026-10-20T12:00:00Z");
const reparse = (text: string) => {
  const r = parseIcs(text, { calendarId: "x", calendarName: "x", timezone: "America/Toronto", now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.report.errors));
  return r;
};

describe("exportShortlistIcs", () => {
  it("exports attendance as a timed event and a known deadline as a separate point entry", () => {
    const r = reparse(exportShortlistIcs([makeOpportunity({ dataset: "real" })], NOW));
    expect(r.report.errors).toEqual([]);
    expect(r.events.map((e) => [e.title, e.start, e.end, e.allDay, e.busy])).toEqual([
      ["Application deadline: Test Event", "2026-11-02T04:59:00.000Z", "2026-11-02T04:59:00.000Z", false, false],
      ["Test Event", "2026-11-14T14:00:00.000Z", "2026-11-14T22:00:00.000Z", false, true],
    ]);
  });

  it("a deadline with an unknown cutoff is an all-day entry on its date", () => {
    const text = exportShortlistIcs([makeOpportunity({ applicationDeadline: "2026-11-01T23:59:59-05:00", exactCutoffUnknown: true })], NOW);
    expect(text).toContain("DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102");
    expect(reparse(text).events[0]).toMatchObject({ title: "[DEMO] Apply by: Test Event (exact time not published)", allDay: true, busy: false });
  });

  it("one event per session, labelling optional ones; unknown hours become all-day", () => {
    const sessions = makeOpportunity({
      applicationDeadline: null,
      attendanceSessions: [
        { start: "2026-11-14T09:00:00-05:00", end: "2026-11-14T12:00:00-05:00", label: "Hacking", mandatory: true },
        { start: "2026-11-14T15:00:00-05:00", end: "2026-11-14T17:00:00-05:00", label: null, mandatory: false },
      ],
    });
    const dateOnly = makeOpportunity({ id: "d", start: "2026-11-21T00:00:00-05:00", end: "2026-11-22T23:59:59-05:00", applicationDeadline: null });
    const titles = reparse(exportShortlistIcs([sessions, dateOnly], NOW)).events.map((e) => [e.title, e.allDay]);
    expect(titles).toEqual([
      ["[DEMO] Test Event: Hacking", false],
      ["[DEMO] Test Event: Session 2 (optional)", false],
      ["[DEMO] Test Event (hours not published)", true],
    ]);
  });

  it("escapes text and folds long lines at 75 octets", () => {
    const text = exportShortlistIcs([makeOpportunity({ name: "Hack; the, North\\ — a very long name that keeps going well past the line limit é" })], NOW);
    expect(text).toContain("Hack\; the\\, North\\\\");
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(reparse(text).events[1].title).toBe("[DEMO] Hack; the, North\\ — a very long name that keeps going well past the line limit é");
  });
});
