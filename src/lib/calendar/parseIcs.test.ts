import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ICS_BYTES, parseIcs } from "./parseIcs";
import { importText, TEST_NOW, TEST_TIMEZONE } from "./testHelpers";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", `${name}.ics`), "utf8");
const parse = (text: string) => parseIcs(text, { calendarId: "t", calendarName: "Test", timezone: TEST_TIMEZONE, now: TEST_NOW });
const starts = (name: string) => importText(fixture(name), name).events.map((e) => [e.title, e.start]);

describe("parseIcs: recurrence", () => {
  it("expands RRULE, applies EXDATE and a moved occurrence (RECURRENCE-ID)", () => {
    expect(starts("recurring")).toEqual([
      ["CS 999 Lecture", "2026-10-26T14:00:00.000Z"], // 10:00 EDT
      // Nov 2 is excluded; Nov 9 moved to Nov 10 13:00 EST.
      ["CS 999 Lecture (moved)", "2026-11-10T18:00:00.000Z"],
      ["CS 999 Lecture", "2026-11-16T15:00:00.000Z"], // 10:00 EST, after DST ends
    ]);
  });

  it("keys occurrences by UID, recurrence id and start", () => {
    const keys = importText(fixture("recurring"), "r").events.map((e) => e.key);
    expect(keys[1]).toBe("cs999-lecture@fixture.example|2026-11-09T10:00:00|2026-11-10T18:00:00.000Z");
    expect(new Set(keys).size).toBe(3);
  });
});

describe("parseIcs: timezones", () => {
  it("keeps 10:00 local across the DST change for a TZID without a VTIMEZONE block", () => {
    const choir = importText(fixture("dst"), "d").events.filter((e) => e.title === "Choir practice");
    expect(choir.map((e) => e.start)).toEqual(["2026-10-25T14:00:00.000Z", "2026-11-01T15:00:00.000Z", "2026-11-08T15:00:00.000Z"]);
    expect(choir.every((e) => e.timeBasis === "iana")).toBe(true);
  });

  it("reads UTC times as UTC and floating times in the student's timezone, with a warning", () => {
    const r = importText(fixture("dst"), "d");
    expect(r.events.find((e) => e.title === "Project call")).toMatchObject({ start: "2026-10-31T23:00:00.000Z", timeBasis: "utc" });
    expect(r.events.find((e) => e.title === "Lunch with Sam")).toMatchObject({ start: "2026-11-01T17:00:00.000Z", timeBasis: "floating" });
    expect(r.report.warnings.map((w) => w.code)).toContain("floating-time");
  });

  it("uses the file's own VTIMEZONE", () => {
    expect(importText(fixture("recurring"), "r").events[0].timeBasis).toBe("vtimezone");
  });
});

describe("parseIcs: status, transparency, all-day", () => {
  const r = importText(fixture("status"), "s");
  const byTitle = (title: string) => r.events.filter((e) => e.title === title);

  it("skips cancelled events and cancelled occurrences, and counts them", () => {
    expect(byTitle("Study group")).toEqual([]);
    expect(byTitle("Gym").map((e) => e.start)).toEqual(["2026-11-03T23:00:00.000Z", "2026-11-17T23:00:00.000Z"]);
    expect(r.report.counts.cancelled).toBe(2);
  });

  it("keeps transparent events but marks them as not busy", () => {
    expect(byTitle("Office hours")[0]).toMatchObject({ busy: false, allDay: false });
    expect(byTitle("Holiday")[0]).toMatchObject({ busy: false, allDay: true });
    expect(r.report.counts.transparent).toBe(2);
  });

  it("reads all-day events as local midnight to midnight; a date with no end lasts one day", () => {
    expect(byTitle("Reading day")[0]).toMatchObject({ start: "2026-11-13T05:00:00.000Z", end: "2026-11-14T05:00:00.000Z", allDay: true, busy: true });
    expect(byTitle("Holiday")[0]).toMatchObject({ start: "2026-11-16T05:00:00.000Z", end: "2026-11-17T05:00:00.000Z" });
  });

  it("marks tentative events", () => {
    expect(byTitle("Coffee chat")[0].tentative).toBe(true);
  });
});

describe("parseIcs: coverage", () => {
  it("covers the earliest to the latest event, ignoring cancelled ones, with the user's note", () => {
    const r = importText(fixture("status"), "s", "  Fall term only ");
    expect(r.calendar.coverage).toMatchObject({ from: "2026-11-03", until: "2026-11-17", note: "Fall term only", unreadableEvents: 0 });
  });

  it("an empty calendar covers nothing", () => {
    const r = importText("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nEND:VCALENDAR\r\n", "e");
    expect(r.calendar.coverage).toMatchObject({ from: null, until: null });
    expect(r.report.warnings.map((w) => w.code)).toContain("empty");
  });

  it("an end at exactly midnight doesn't extend coverage into the next day", () => {
    expect(importText(fixture("dst"), "d").calendar.coverage).toMatchObject({ from: "2026-10-25", until: "2026-11-08" });
  });

  it("open-ended repeats stop at the window and say so", () => {
    const text = fixture("dst").replace("RRULE:FREQ=WEEKLY;COUNT=3", "RRULE:FREQ=WEEKLY");
    const r = importText(text, "d");
    expect(r.report.warnings.find((w) => w.code === "open-ended-recurrence")?.message).toMatch(/included up to 2027-11-24/);
    expect(r.calendar.coverage.until).toBe("2027-11-21");
  });
});

describe("parseIcs: problems are reported, not dropped silently", () => {
  it("lists each unreadable event and keeps the readable ones", () => {
    const r = importText(fixture("malformed"), "m");
    expect(r.events.map((e) => e.title)).toEqual(["Readable event", "No UID", "Seminar", "Seminar", "Seminar"]);
    expect(r.report.errors.map((e) => [e.code, e.summary])).toEqual([
      ["bad-event", "Bad date"],
      ["unknown-timezone", "Mars meeting"],
      ["bad-event", "No start"],
      ["bad-event", "Backwards"],
    ]);
    expect(r.report.counts.unreadable).toBe(4);
    expect(r.calendar.coverage.unreadableEvents).toBe(4);
    expect(r.report.warnings.map((w) => w.code)).toEqual(["unsupported-component", "missing-uid", "unsupported-property"]);
  });

  it("rejects text that isn't iCalendar", () => {
    const r = parse("hello world");
    expect(r.ok).toBe(false);
    expect(r.report.errors[0].code).toBe("malformed");
    expect(parse("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD").report.errors[0].code).toBe("not-a-calendar");
  });

  it("rejects oversized files before parsing", () => {
    const r = parse(`BEGIN:VCALENDAR\n${"X-PAD:".padEnd(70, "x")}\n`.repeat(Math.ceil(MAX_ICS_BYTES / 70) + 1));
    expect(r.ok).toBe(false);
    expect(r.report.errors[0].code).toBe("too-large");
  });

  it("rejects a calendar that expands to too many occurrences", () => {
    const text = fixture("dst").replace("RRULE:FREQ=WEEKLY;COUNT=3", "RRULE:FREQ=MINUTELY;INTERVAL=30");
    const r = parse(text);
    expect(r.ok).toBe(false);
    expect(r.report.errors[0].code).toBe("too-many-occurrences");
  });

  it("counts duplicate events within one file once", () => {
    const text = fixture("adjacent");
    const doubled = text.replace("END:VCALENDAR", text.slice(text.indexOf("BEGIN:VEVENT"), text.indexOf("BEGIN:VEVENT", text.indexOf("BEGIN:VEVENT") + 1)) + "END:VCALENDAR");
    const r = importText(doubled, "a");
    expect(r.events).toHaveLength(2);
    expect(r.report.warnings.map((w) => w.code)).toContain("bad-event");
    expect(r.report.counts.duplicates).toBe(1);
  });
});
