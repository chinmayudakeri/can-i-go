import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseManualCommitment } from "./commitments";
import { CALENDAR_STORAGE_KEY, deleteCalendarData, loadCalendarStore, loadCommitments, saveCalendarStore, saveCommitments } from "./storage";
import { addImport, coverageOf, EMPTY_CALENDAR_STORE, eventsAsCommitments, removeCalendar } from "./store";
import { importText } from "./testHelpers";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", `${name}.ics`), "utf8");

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe("calendar store", () => {
  it("skips duplicates when the same file is imported again as another calendar", () => {
    const first = importText(fixture("recurring"), "cal-1");
    const second = importText(fixture("recurring"), "cal-2");
    const a = addImport(EMPTY_CALENDAR_STORE, first.calendar, first.events);
    const b = addImport(a.store, second.calendar, second.events);
    expect(a).toMatchObject({ added: 3, duplicatesSkipped: 0 });
    expect(b).toMatchObject({ added: 0, duplicatesSkipped: 3 });
    expect(b.store.events).toHaveLength(3);
    expect(b.store.calendars.map((c) => c.id)).toEqual(["cal-1", "cal-2"]);
  });

  it("re-importing a calendar under the same id replaces its events", () => {
    const first = importText(fixture("recurring"), "cal-1");
    const a = addImport(EMPTY_CALENDAR_STORE, first.calendar, first.events);
    const b = addImport(a.store, first.calendar, first.events.slice(0, 1));
    expect(b).toMatchObject({ added: 1, duplicatesSkipped: 0 });
    expect(b.store.events).toHaveLength(1);
  });

  it("holds several calendars, each with its own coverage, and removes one cleanly", () => {
    const classes = importText(fixture("recurring"), "classes");
    const personal = importText(fixture("dst"), "personal");
    let store = addImport(EMPTY_CALENDAR_STORE, classes.calendar, classes.events).store;
    store = addImport(store, personal.calendar, personal.events).store;
    expect(store.events).toHaveLength(8);
    expect(coverageOf(store).map((c) => [c.calendarId, c.from, c.until])).toEqual([
      ["classes", "2026-10-26", "2026-11-16"],
      ["personal", "2026-10-25", "2026-11-08"],
    ]);
    const commitments = eventsAsCommitments(store);
    expect(commitments.find((c) => c.title === "Choir practice")).toMatchObject({ kind: "calendar", calendarName: "personal", busy: true });
    expect(removeCalendar(store, "classes").events).toHaveLength(5);
  });
});

describe("manual commitments", () => {
  it("an assignment is a deadline, not a block of time", () => {
    const r = parseManualCommitment({ id: "a1", kind: "assignment", title: " A3 ", due: "2026-11-13T23:59:00-05:00" });
    expect(r).toEqual({ ok: true, commitment: { id: "a1", kind: "assignment", title: "A3", due: "2026-11-13T23:59:00-05:00" } });
  });

  it.each([
    [{ id: "x", kind: "nap", title: "Nap", start: "2026-11-13T10:00:00-05:00", end: "2026-11-13T11:00:00-05:00" }, /Unknown kind/],
    [{ id: "x", kind: "exam", title: "Final", start: "2026-11-13T10:00:00-05:00" }, /start and an end/],
    [{ id: "x", kind: "work", title: "Shift", start: "2026-11-13T10:00:00-05:00", end: "2026-11-13T10:00:00-05:00" }, /end after/],
    [{ id: "x", kind: "assignment", title: "A3", start: "2026-11-13T10:00:00-05:00", end: "2026-11-13T11:00:00-05:00" }, /due date/],
    [{ id: "x", kind: "class", title: " ", start: "2026-11-13T10:00:00-05:00", end: "2026-11-13T11:00:00-05:00" }, /name/],
  ])("rejects %j", (raw, message) => {
    const r = parseManualCommitment(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

describe("calendar storage (browser only)", () => {
  it("round-trips calendars and commitments, and deletes both", () => {
    const store = memoryStore();
    const imported = importText(fixture("recurring"), "c");
    const value = addImport(EMPTY_CALENDAR_STORE, imported.calendar, imported.events).store;
    saveCalendarStore(store, value);
    const commitment = parseManualCommitment({ id: "e", kind: "exam", title: "Final", start: "2026-11-16T09:00:00-05:00", end: "2026-11-16T11:30:00-05:00" });
    if (!commitment.ok) throw new Error(commitment.error);
    saveCommitments(store, [commitment.commitment]);

    expect(loadCalendarStore(store)).toEqual({ ok: true, value, dropped: 0 });
    expect(loadCommitments(store)).toEqual({ ok: true, value: [commitment.commitment], dropped: 0 });
    deleteCalendarData(store);
    expect(store.data.size).toBe(0);
    expect(loadCalendarStore(store)).toMatchObject({ ok: true, value: { calendars: [], events: [] } });
  });

  it("drops and counts malformed or orphaned entries; reports unreadable JSON", () => {
    const store = memoryStore();
    const imported = importText(fixture("adjacent"), "c");
    store.setItem(
      CALENDAR_STORAGE_KEY,
      JSON.stringify({ calendars: [imported.calendar, { id: 1 }], events: [...imported.events, { key: "x" }, { ...imported.events[0], key: "y", calendarId: "gone" }] }),
    );
    expect(loadCalendarStore(store)).toMatchObject({ ok: true, dropped: 3 });
    store.setItem(CALENDAR_STORAGE_KEY, "{");
    expect(loadCalendarStore(store).ok).toBe(false);
  });
});
