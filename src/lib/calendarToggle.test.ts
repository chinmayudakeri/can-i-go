import { describe, expect, it } from "vitest";
import { importText } from "./calendar/testHelpers";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseManualCommitment } from "./calendar/commitments";
import { loadCalendarStore, loadCommitments, saveCalendarStore, saveCommitments } from "./calendar/storage";
import { addImport, EMPTY_CALENDAR_STORE } from "./calendar/store";
import { CALENDAR_TOGGLE_STORAGE_KEY, loadCalendarEnabled, saveCalendarEnabled } from "./calendarToggle";
import { buildStudentContext, feasibilityForAll } from "./feasibility/forOpportunity";
import { deleteAllData } from "./privacyData";
import { makeOpportunity, makeProfile } from "./testFixtures";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

/** A browser with one imported calendar and one exam saved. */
function browserWithCalendar() {
  const store = memoryStore();
  const imported = importText(readFileSync(path.join(__dirname, "calendar/fixtures/adjacent.ics"), "utf8"), "cal");
  saveCalendarStore(store, addImport(EMPTY_CALENDAR_STORE, imported.calendar, imported.events).store);
  const exam = parseManualCommitment({ id: "e", kind: "exam", title: "Final", start: "2026-11-16T14:00:00Z", end: "2026-11-16T16:00:00Z" });
  if (!exam.ok) throw new Error(exam.error);
  saveCommitments(store, [exam.commitment]);
  return store;
}

describe("Use my calendar switch", () => {
  it("is off for a new visitor and when storage holds anything else or can't be read", () => {
    const store = memoryStore();
    expect(loadCalendarEnabled(store)).toBe(false);
    store.setItem(CALENDAR_TOGGLE_STORAGE_KEY, "yes");
    expect(loadCalendarEnabled(store)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(loadCalendarEnabled(broken)).toBe(false);
  });

  it("remembers on and off", () => {
    const store = memoryStore();
    saveCalendarEnabled(store, true);
    expect(loadCalendarEnabled(store)).toBe(true);
    saveCalendarEnabled(store, false);
    expect(loadCalendarEnabled(store)).toBe(false);
  });

  it("turning it off and on again keeps every calendar and commitment", () => {
    const store = browserWithCalendar();
    saveCalendarEnabled(store, true);
    const before = { calendar: loadCalendarStore(store), commitments: loadCommitments(store) };

    saveCalendarEnabled(store, false);
    expect(loadCalendarStore(store)).toEqual(before.calendar);
    expect(loadCommitments(store)).toEqual(before.commitments);

    saveCalendarEnabled(store, true);
    expect(loadCalendarStore(store)).toEqual(before.calendar);
    expect(loadCommitments(store)).toEqual(before.commitments);
    expect(before.calendar).toMatchObject({ ok: true, value: { calendars: [{ id: "cal" }] } });
  });

  it("only Delete my data removes it, and the switch goes back to off", () => {
    const store = browserWithCalendar();
    saveCalendarEnabled(store, true);
    deleteAllData(store);
    expect(store.data.size).toBe(0);
    expect(loadCalendarEnabled(store)).toBe(false);
  });
});

describe("feasibility with the switch on and off", () => {
  const opp = makeOpportunity();
  const store = browserWithCalendar();
  const calendar = loadCalendarStore(store);
  const commitments = loadCommitments(store);
  if (!calendar.ok || !commitments.ok) throw new Error("fixture");
  const ctx = buildStudentContext({
    profile: makeProfile({ travelMinutes: 30 }),
    calendar: calendar.value,
    manual: commitments.value,
    shortlist: [],
    opportunities: [opp],
    timezone: "America/Toronto",
  });
  const now = new Date("2026-10-20T12:00:00Z");

  it("on: every opportunity is checked", () => {
    const results = feasibilityForAll([opp], ctx, now);
    expect(results.get(opp.id)?.view.label).toBe("1 conflict found");
  });

  it("off: there is no context, so nothing is checked", () => {
    expect(feasibilityForAll([opp], null, now).size).toBe(0);
  });
});
