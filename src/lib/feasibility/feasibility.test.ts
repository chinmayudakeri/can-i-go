import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseManualCommitment } from "../calendar/commitments";
import { addImport, coverageOf, EMPTY_CALENDAR_STORE, eventsAsCommitments } from "../calendar/store";
import { importText, TEST_NOW } from "../calendar/testHelpers";
import type { CalendarCoverage, Commitment } from "../calendar/types";
import { makeOpportunity } from "../testFixtures";
import type { Opportunity } from "../types";
import { checkFeasibility, DEFAULT_ASSUMPTIONS, eventHoursUnknown, findShortlistConflicts, type FeasibilityAssumptions, type FeasibilityInput } from ".";

const fixture = (name: string) => readFileSync(path.join(__dirname, "../calendar/fixtures", `${name}.ics`), "utf8");

/** Imports fixtures into one store and returns its commitments and coverage. */
function calendars(...names: string[]): { commitments: Commitment[]; coverage: CalendarCoverage[] } {
  let store = EMPTY_CALENDAR_STORE;
  for (const [i, name] of names.entries()) {
    const r = importText(fixture(name), names.indexOf(name) === i ? name : `${name}-${i}`);
    store = addImport(store, r.calendar, r.events).store;
  }
  return { commitments: eventsAsCommitments(store), coverage: coverageOf(store) };
}

const ALL_COVERED: CalendarCoverage[] = [
  { calendarId: "all", calendarName: "All", from: "2026-01-01", until: "2027-12-31", timezone: "America/Toronto", note: null, unreadableEvents: 0 },
];

function manual(raw: Record<string, unknown>): Commitment {
  const r = parseManualCommitment({ id: String(raw.title), ...raw });
  if (!r.ok) throw new Error(r.error);
  return r.commitment;
}

function check(opportunity: Opportunity, overrides: Partial<Omit<FeasibilityInput, "assumptions">> & { assumptions?: Partial<FeasibilityAssumptions> } = {}) {
  const { assumptions, ...rest } = overrides;
  return checkFeasibility({
    opportunity,
    commitments: [],
    coverage: ALL_COVERED,
    now: TEST_NOW,
    ...rest,
    assumptions: { ...DEFAULT_ASSUMPTIONS, oneWayTravelMinutes: 0, arrivalBufferMinutes: 0, ...assumptions },
  });
}

/** Sat Nov 14, 9:00 AM – 5:00 PM EST, in person in Waterloo. */
const saturday = makeOpportunity();

describe("adjacent commitments: zero gap versus a travel buffer", () => {
  const { commitments, coverage } = calendars("adjacent");

  it("a shift ending exactly when the event starts is not a conflict with no travel", () => {
    const r = check(saturday, { commitments, coverage });
    expect(r.hardConflicts).toEqual([]);
    expect(r.status).toBe("no conflicts found");
  });

  it("the same shift conflicts once travel and an arrival buffer are needed", () => {
    const r = check(saturday, { commitments, coverage, assumptions: { oneWayTravelMinutes: 45, arrivalBufferMinutes: 15 } });
    expect(r.status).toBe("conflicts");
    expect(r.hardConflicts).toHaveLength(1);
    expect(r.hardConflicts[0]).toMatchObject({ code: "travel-outbound" });
    expect(r.hardConflicts[0].message).toBe(
      '"Morning shift" (Sat, Nov 14, 7:00 – 9:00 AM EST) from your adjacent calendar overlaps your trip to Test Event: 45 minutes of travel plus your 15-minute arrival buffer means leaving by Sat, Nov 14, 8:00 AM EST (travel window Sat, Nov 14, 8:00 – 9:00 AM EST).',
    );
  });

  it("travel home conflicts with an evening commitment", () => {
    const r = check(saturday, { commitments, coverage, assumptions: { oneWayTravelMinutes: 90 } });
    const back = r.hardConflicts.find((f) => f.code === "travel-return");
    expect(back?.message).toMatch(/^"Family dinner" \(Sat, Nov 14, 6:00 – 8:00 PM EST\).*trip home from Test Event: 90 minutes of travel after it ends \(Sat, Nov 14, 5:00 – 6:30 PM EST\)/);
  });
});

describe("a DST change weekend", () => {
  // Sat Oct 31 9:00 AM EDT to Sun Nov 1 12:00 PM EST; clocks go back at 2:00 AM Sunday.
  const hackathon = makeOpportunity({ start: "2026-10-31T09:00:00-04:00", end: "2026-11-01T12:00:00-05:00", applicationDeadline: null });
  const { commitments, coverage } = calendars("dst");
  const r = check(hackathon, { commitments, coverage, now: new Date("2026-10-01T12:00:00Z") });

  it("places Sunday's 10:00 practice in EST and flags it, but not the lunch right after the event", () => {
    const titles = r.hardConflicts.map((f) => f.message.match(/^"([^"]+)"/)?.[1]);
    expect(titles).toEqual(["Project call", "Choir practice"]);
    expect(r.hardConflicts[1].message).toContain("Sun, Nov 1, 10:00 – 11:00 AM EST");
    expect(r.hardConflicts[1].message).toContain("Sat, Oct 31, 9:00 AM EDT – Sun, Nov 1, 12:00 PM EST");
  });
});

describe("recurring events with an exclusion and a moved occurrence", () => {
  const { commitments, coverage } = calendars("recurring");
  const online = (start: string, end: string) => makeOpportunity({ format: "online", location: null, start, end, applicationDeadline: null });

  it("the excluded Monday and the original slot of the moved one are free", () => {
    expect(check(online("2026-11-02T09:30:00-05:00", "2026-11-02T12:00:00-05:00"), { commitments, coverage }).status).toBe("no conflicts found");
    expect(check(online("2026-11-09T09:30:00-05:00", "2026-11-09T12:00:00-05:00"), { commitments, coverage }).status).toBe("no conflicts found");
  });

  it("the moved occurrence conflicts at its new time", () => {
    const r = check(online("2026-11-10T12:00:00-05:00", "2026-11-10T15:00:00-05:00"), { commitments, coverage });
    expect(r.hardConflicts.map((f) => f.message)).toEqual([expect.stringMatching(/^"CS 999 Lecture \(moved\)" \(Tue, Nov 10, 1:00 – 2:20 PM EST\)/)]);
  });
});

describe("cancelled, transparent and all-day events", () => {
  const { commitments, coverage } = calendars("status");
  const online = (start: string, end: string) => makeOpportunity({ format: "online", location: null, start, end, applicationDeadline: null });

  it("a cancelled event and a transparent event don't block time", () => {
    // Study group (cancelled) 10–12 and office hours (transparent) 9–10 on Nov 14.
    const r = check(online("2026-11-14T09:00:00-05:00", "2026-11-14T12:00:00-05:00"), { commitments, coverage });
    expect(r.hardConflicts).toEqual([]);
    expect(r.status).toBe("no conflicts found");
  });

  it("a cancelled occurrence of a weekly event is free", () => {
    expect(check(online("2026-11-10T18:00:00-05:00", "2026-11-10T19:00:00-05:00"), { commitments, coverage }).hardConflicts).toEqual([]);
    expect(check(online("2026-11-17T18:00:00-05:00", "2026-11-17T19:00:00-05:00"), { commitments, coverage }).hardConflicts).toHaveLength(1);
  });

  it("an all-day busy event conflicts and says so; a transparent all-day one doesn't", () => {
    const r = check(online("2026-11-13T15:00:00-05:00", "2026-11-13T20:00:00-05:00"), { commitments, coverage });
    expect(r.hardConflicts.map((f) => f.message)).toEqual([expect.stringMatching(/^"Reading day" \(Fri, Nov 13, marked busy all day\)/)]);
    expect(check(online("2026-11-16T10:00:00-05:00", "2026-11-16T12:00:00-05:00"), { commitments, coverage }).hardConflicts).toEqual([]);
  });

  it("a tentative event still blocks time, labelled tentative", () => {
    const r = check(online("2026-11-15T15:00:00-05:00", "2026-11-15T16:00:00-05:00"), { commitments, coverage });
    expect(r.hardConflicts[0].message).toContain("3:00 – 3:30 PM EST, tentative");
  });
});

describe("duplicate imports", () => {
  it("importing the same calendar twice reports each conflict once", () => {
    const { commitments, coverage } = calendars("adjacent", "adjacent");
    expect(commitments).toHaveLength(2);
    const r = check(saturday, { commitments, coverage, assumptions: { oneWayTravelMinutes: 30 } });
    expect(r.hardConflicts).toHaveLength(1);
  });
});

describe("calendar coverage", () => {
  it("no calendar at all: coverage incomplete, never free", () => {
    const r = check(saturday, { coverage: [] });
    expect(r.status).toBe("calendar coverage incomplete");
    expect(r.uncoveredDates).toEqual(["2026-11-14"]);
    expect(r.summary).toMatch(/^Calendar coverage incomplete: no imported calendar covers 2026-11-14/);
  });

  it("a calendar that covers only part of a multi-day event", () => {
    const { commitments, coverage } = calendars("adjacent"); // covers Nov 14 only
    const weekend = makeOpportunity({ start: "2026-11-14T09:00:00-05:00", end: "2026-11-15T17:00:00-05:00" });
    const r = check(weekend, { commitments: commitments.filter((c) => c.title === "Morning shift"), coverage });
    expect(r.status).toBe("calendar coverage incomplete");
    expect(r.uncoveredDates).toEqual(["2026-11-15"]);
    expect(r.missingInformation.find((m) => m.code === "calendar-coverage")).toMatchObject({ blocking: true });
  });

  it("travel the evening before counts toward the dates that need coverage", () => {
    const early = makeOpportunity({ start: "2026-11-14T07:00:00-05:00", end: "2026-11-14T12:00:00-05:00" });
    const covered: CalendarCoverage[] = [{ ...ALL_COVERED[0], from: "2026-11-14", until: "2026-11-14" }];
    const r = check(early, { coverage: covered, assumptions: { oneWayTravelMinutes: 480 } });
    expect(r.uncoveredDates).toEqual(["2026-11-13"]);
  });

  it("hard conflicts are still reported when coverage is incomplete", () => {
    // An exam during the event clashes with it directly, so it stays hard.
    const exam = manual({ kind: "exam", title: "Final", start: "2026-11-14T10:00:00-05:00", end: "2026-11-14T12:00:00-05:00" });
    expect(check(saturday, { commitments: [exam], coverage: [] }).status).toBe("conflicts");
  });

  it("notes unreadable events in a calendar that covers the dates", () => {
    const r = check(saturday, { coverage: [{ ...ALL_COVERED[0], unreadableEvents: 2 }] });
    expect(r.missingInformation.find((m) => m.code === "calendar-unreadable")?.message).toMatch(/^2 events in "All" couldn't be read/);
  });
});

describe("deadlines", () => {
  it("a passed application deadline is a strong warning, not a time clash", () => {
    const r = check(saturday, { now: new Date("2026-11-05T12:00:00Z") });
    expect(r.hardConflicts).toEqual([]);
    expect(r.softWarnings).toEqual([
      { code: "deadline-passed", message: "Applications for Test Event closed Sun, Nov 1, 11:59 PM EST.", commitmentId: null, opportunityId: null, strong: true },
    ]);
  });

  it("an unknown deadline is listed as missing but doesn't block", () => {
    const r = check(makeOpportunity({ applicationDeadline: null }));
    expect(r.missingInformation).toEqual([{ code: "application-deadline", message: "The application deadline isn't published.", blocking: false }]);
    expect(r.status).toBe("no conflicts found");
  });

  it("an event that has already ended", () => {
    const r = check(saturday, { now: new Date("2026-11-20T12:00:00Z") });
    expect(r.softWarnings.find((f) => f.code === "event-ended")).toMatchObject({ strong: true });
    expect(r.hardConflicts).toEqual([]);
  });
});

describe("exams and assignments", () => {
  // The event ends Sat Nov 14, 5:00 PM EST; a 2-day buffer runs to Mon Nov 16, 5:00 PM EST.
  const exam = (start: string, end: string) => manual({ kind: "exam", title: "MATH 999 final", start, end });

  it("an exam exactly at the edge of the preparation buffer is fine", () => {
    const r = check(saturday, { commitments: [exam("2026-11-16T17:00:00-05:00", "2026-11-16T19:30:00-05:00")], assumptions: { examPrepDays: 2 } });
    expect(r.hardConflicts).toEqual([]);
    expect(r.softWarnings).toEqual([]);
  });

  it("one minute earlier is a strong soft warning, not a hard conflict", () => {
    const r = check(saturday, { commitments: [exam("2026-11-16T16:59:00-05:00", "2026-11-16T19:30:00-05:00")], assumptions: { examPrepDays: 2 } });
    expect(r.hardConflicts).toEqual([]);
    expect(r.status).toBe("no conflicts found");
    expect(r.softWarnings).toEqual([
      {
        code: "exam-prep",
        message:
          'Your exam "MATH 999 final" (Mon, Nov 16, 4:59 – 7:30 PM EST) is 1 day 23 hours 59 minutes after Test Event ends (Sat, Nov 14, 5:00 PM EST), inside your 2-day exam preparation buffer.',
        commitmentId: "MATH 999 final",
        opportunityId: null,
        strong: true,
      },
    ]);
  });

  it("an exam in a break between sessions is a strong warning that says so", () => {
    const twoDays = makeOpportunity({
      end: "2026-11-15T17:00:00-05:00",
      attendanceSessions: [
        { start: "2026-11-14T09:00:00-05:00", end: "2026-11-14T12:00:00-05:00", label: "Day 1", mandatory: true },
        { start: "2026-11-15T09:00:00-05:00", end: "2026-11-15T17:00:00-05:00", label: "Day 2", mandatory: true },
      ],
    });
    const r = check(twoDays, { commitments: [exam("2026-11-14T14:00:00-05:00", "2026-11-14T16:00:00-05:00")] });
    expect(r.hardConflicts).toEqual([]);
    expect(r.softWarnings.find((f) => f.code === "exam-prep")?.message).toMatch(/falls during Test Event \(between sessions\), inside your 2-day/);
  });

  it("an exam during the event is a direct conflict, reported once", () => {
    const r = check(saturday, { commitments: [exam("2026-11-14T13:00:00-05:00", "2026-11-14T15:00:00-05:00")] });
    expect(r.hardConflicts.map((f) => f.code)).toEqual(["session-conflict"]);
  });

  it("an assignment due near the event is a soft warning; one due well before isn't mentioned", () => {
    const near = manual({ kind: "assignment", title: "A3", due: "2026-11-13T23:59:00-05:00" });
    const far = manual({ kind: "assignment", title: "A1", due: "2026-11-02T23:59:00-05:00" });
    const r = check(saturday, { commitments: [near, far] });
    expect(r.hardConflicts).toEqual([]);
    expect(r.softWarnings.map((f) => f.message)).toEqual(['Your assignment "A3" is due Fri, Nov 13, 11:59 PM EST, 9 hours 1 minute before Test Event starts. Plan to finish it early.']);
    expect(r.summary).toBe("No conflicts found with your calendar and commitments. Check 1 warning.");
  });

  it("an assignment due during the event", () => {
    const due = manual({ kind: "assignment", title: "Lab 4", due: "2026-11-14T12:00:00-05:00" });
    expect(check(saturday, { commitments: [due] }).softWarnings[0].message).toContain("while Test Event is on");
  });
});

describe("sessions and mandatory attendance", () => {
  const weekend = makeOpportunity({
    start: "2026-11-14T09:00:00-05:00",
    end: "2026-11-15T17:00:00-05:00",
    attendanceSessions: [
      { start: "2026-11-14T09:00:00-05:00", end: "2026-11-14T22:00:00-05:00", label: "Day 1 hacking", mandatory: true },
      { start: "2026-11-15T09:00:00-05:00", end: "2026-11-15T12:00:00-05:00", label: "Day 2 hacking", mandatory: null },
      { start: "2026-11-15T13:00:00-05:00", end: "2026-11-15T17:00:00-05:00", label: "Closing ceremony", mandatory: false },
    ],
  });
  const personal = (title: string, start: string, end: string) => manual({ kind: "personal", title, start, end });

  it("an overnight commitment between sessions is not a hard conflict, but warns in person", () => {
    const r = check(weekend, { commitments: [personal("Night shift", "2026-11-14T23:00:00-05:00", "2026-11-15T06:00:00-05:00")] });
    expect(r.hardConflicts).toEqual([]);
    expect(r.softWarnings.map((f) => f.code)).toEqual(["between-sessions"]);
    expect(r.softWarnings[0].message).toMatch(/Breaks aren't required, but you'd be away at Waterloo/);
  });

  it("the same overnight commitment is fine for an online event", () => {
    const online = { ...weekend, format: "online" as const, location: null };
    expect(check(online, { commitments: [personal("Night shift", "2026-11-14T23:00:00-05:00", "2026-11-15T06:00:00-05:00")] }).softWarnings).toEqual([]);
  });

  it("required sessions are hard, unstated ones are treated as required, optional ones are soft", () => {
    const r = check(weekend, {
      commitments: [
        personal("Brunch", "2026-11-14T11:00:00-05:00", "2026-11-14T12:00:00-05:00"),
        personal("Call", "2026-11-15T10:00:00-05:00", "2026-11-15T10:30:00-05:00"),
        personal("Dinner", "2026-11-15T15:00:00-05:00", "2026-11-15T16:00:00-05:00"),
      ],
    });
    expect(r.hardConflicts.map((f) => f.message)).toEqual([
      'Your commitment "Brunch" (Sat, Nov 14, 11:00 AM – 12:00 PM EST) overlaps "Day 1 hacking" (Sat, Nov 14, 9:00 AM – 10:00 PM EST), a required session of Test Event.',
      `Your commitment "Call" (Sun, Nov 15, 10:00 – 10:30 AM EST) overlaps "Day 2 hacking" (Sun, Nov 15, 9:00 AM – 12:00 PM EST) of Test Event. The event doesn't say whether it's optional, so it's treated as required.`,
    ]);
    expect(r.softWarnings.map((f) => f.code)).toEqual(["optional-session-conflict"]);
    expect(r.missingInformation.map((m) => m.code)).toContain("session-mandatory");
  });

  it("travel home leaves after the last required session, not the optional closing", () => {
    const r = check(weekend, { commitments: [personal("Dinner", "2026-11-15T12:30:00-05:00", "2026-11-15T13:00:00-05:00")], assumptions: { oneWayTravelMinutes: 60 } });
    expect(r.hardConflicts.map((f) => f.code)).toEqual(["travel-return"]);
  });

  it("without sessions, the whole event is required", () => {
    const r = check(saturday, { commitments: [personal("Lunch", "2026-11-14T12:00:00-05:00", "2026-11-14T13:00:00-05:00")] });
    expect(r.plan.basis).toBe("event hours");
    expect(r.hardConflicts[0].message).toMatch(/No session schedule is published, so the whole event is treated as required\.$/);
  });
});

describe("unknown event hours: conservative date window", () => {
  // Ingestion stores a date with no stated time as 00:00:00 to 23:59:59 local.
  const dateOnly = makeOpportunity({ start: "2026-11-14T00:00:00-05:00", end: "2026-11-14T23:59:59-05:00" });

  it("is detected and labelled", () => {
    expect(eventHoursUnknown(dateOnly)).toBe(true);
    expect(eventHoursUnknown(saturday)).toBe(false);
    const r = check(dateOnly);
    expect(r.plan.basis).toBe("conservative date window");
    expect(r.missingInformation.find((m) => m.code === "event-hours")?.message).toBe(
      "Event hours aren't published, so we assume it could run all day on Sat, Nov 14 (conservative).",
    );
  });

  it("an evening commitment on that day is a conflict, explained as conservative", () => {
    const r = check(dateOnly, { commitments: [manual({ kind: "work", title: "Late shift", start: "2026-11-14T20:00:00-05:00", end: "2026-11-14T23:00:00-05:00" })] });
    expect(r.hardConflicts[0].message).toBe(
      `Your work shift "Late shift" (Sat, Nov 14, 8:00 – 11:00 PM EST) falls on Test Event's dates (Sat, Nov 14). The event's hours aren't published, so we assume it could run all day (conservative).`,
    );
  });
});

describe("travel information", () => {
  it("a null location makes travel 'needs confirmation', never zero", () => {
    const r = check(makeOpportunity({ location: null }), {
      commitments: [manual({ kind: "work", title: "Shift", start: "2026-11-14T07:00:00-05:00", end: "2026-11-14T09:00:00-05:00" })],
      assumptions: { oneWayTravelMinutes: 0 },
    });
    expect(r.plan.travel).toEqual({ status: "needs confirmation", reason: "location" });
    expect(r.status).toBe("needs confirmation");
    expect(r.missingInformation.find((m) => m.code === "location")).toMatchObject({ blocking: true });
  });

  it("travel time not entered: needs confirmation", () => {
    const r = check(saturday, { assumptions: { oneWayTravelMinutes: null } });
    expect(r.status).toBe("needs confirmation");
    expect(r.missingInformation.find((m) => m.code === "travel-time")?.message).toBe(
      "Enter how long it takes you to get to Waterloo (one way) so we can check travel conflicts.",
    );
  });

  it("online events need no travel; hybrid follows the student's choice", () => {
    expect(check(makeOpportunity({ format: "online", location: null }), { assumptions: { oneWayTravelMinutes: null } }).status).toBe("no conflicts found");
    const hybrid = makeOpportunity({ format: "hybrid" });
    expect(check(hybrid, { assumptions: { oneWayTravelMinutes: null, hybridAttendance: "online" } }).plan.travel).toEqual({ status: "not needed" });
    expect(check(hybrid, { assumptions: { oneWayTravelMinutes: null } }).plan.travel.status).toBe("needs confirmation");
  });
});

describe("shortlisted events", () => {
  const a = makeOpportunity({ id: "a", name: "Maple Hacks" });
  const b = makeOpportunity({ id: "b", name: "Birch Jam", start: "2026-11-14T16:00:00-05:00", end: "2026-11-14T21:00:00-05:00" });
  const c = makeOpportunity({ id: "c", name: "Cedar Talks", start: "2026-11-14T18:00:00-05:00", end: "2026-11-14T20:00:00-05:00" });

  it("two overlapping shortlisted events are a hard conflict naming the other event", () => {
    const r = check(a, { shortlist: [{ opportunity: a, oneWayTravelMinutes: 0 }, { opportunity: b, oneWayTravelMinutes: 0 }] });
    expect(r.hardConflicts).toEqual([
      {
        code: "shortlist-overlap",
        message: 'Maple Hacks overlaps "Birch Jam", which is also on your shortlist (both need Sat, Nov 14, 4:00 – 5:00 PM EST).',
        commitmentId: null,
        opportunityId: "b",
      },
    ]);
  });

  it("events an hour apart conflict only once travel is counted", () => {
    expect(check(a, { shortlist: [{ opportunity: c, oneWayTravelMinutes: 0 }] }).hardConflicts).toEqual([]);
    const r = check(a, { shortlist: [{ opportunity: c, oneWayTravelMinutes: 45 }], assumptions: { oneWayTravelMinutes: 45 } });
    expect(r.hardConflicts.map((f) => f.message)).toEqual([expect.stringMatching(/\(both need Sat, Nov 14, 5:15 – 5:45 PM EST, including travel\)\.$/)]);
  });

  it("finds every conflicting pair", () => {
    const pairs = findShortlistConflicts(
      [a, b, c].map((opportunity) => ({ opportunity, oneWayTravelMinutes: null })),
      DEFAULT_ASSUMPTIONS,
    );
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });
});
