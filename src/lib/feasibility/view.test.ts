import { describe, expect, it } from "vitest";
import { makeOpportunity, makeProfile } from "../testFixtures";
import { assumptionsFromProfile, describeAssumptions } from "./assumptions";
import { checkFeasibility } from ".";
import type { CalendarCoverage, Commitment } from "../calendar/types";
import { feasibilityView, NOT_CHECKED_LABEL } from "./view";

const NOW = new Date("2026-10-20T12:00:00Z");
const covered: CalendarCoverage[] = [
  { calendarId: "c", calendarName: "Classes", from: "2026-09-01", until: "2026-12-31", timezone: "America/Toronto", note: null, unreadableEvents: 0 },
];
const lunch: Commitment = {
  id: "l",
  kind: "personal",
  title: "Lunch",
  start: "2026-11-14T17:00:00Z",
  end: "2026-11-14T18:00:00Z",
  allDay: false,
  busy: true,
  tentative: false,
  calendarName: null,
};

function run(commitments: Commitment[], coverage: CalendarCoverage[], travelMinutes: number | null = 30) {
  const { assumptions } = assumptionsFromProfile(makeProfile({ travelMinutes }), null, "America/Toronto");
  return checkFeasibility({ opportunity: makeOpportunity(), commitments, coverage, assumptions, now: NOW });
}

describe("assumptionsFromProfile", () => {
  it("uses the event's own travel time over the profile default, and says which", () => {
    const profile = makeProfile({ travelMinutes: 30, arrivalBufferMinutes: 10, examPrepDays: 3, formatPreference: "online" });
    expect(assumptionsFromProfile(profile, 90, "America/Vancouver")).toMatchObject({
      assumptions: { oneWayTravelMinutes: 90, arrivalBufferMinutes: 10, examPrepDays: 3, hybridAttendance: "online", timezone: "America/Vancouver" },
      travelSource: "this event",
    });
    expect(assumptionsFromProfile(profile, null, "America/Toronto").travelSource).toBe("your profile");
  });

  it("never invents a travel time, and falls back to safe defaults", () => {
    const used = assumptionsFromProfile(null, null, "Not/AZone");
    expect(used).toMatchObject({ assumptions: { oneWayTravelMinutes: null, arrivalBufferMinutes: 30, examPrepDays: 2, timezone: "America/Toronto" }, travelSource: "not entered" });
    expect(describeAssumptions(used)[0]).toBe("Travel time: not entered (travel needs confirmation)");
  });

  it("describes the assumptions in plain language", () => {
    expect(describeAssumptions(assumptionsFromProfile(makeProfile({ travelMinutes: 45 }), null, "America/Toronto"))).toEqual([
      "Travel time: 45 minutes each way (from your profile)",
      "Arrive 30 minutes before the first session",
      "Keep 2 days before an exam free to study",
      "Assignments due within 48 hours of the event get a warning",
      "Hybrid events: assumed you attend in person",
      "Times shown in America/Toronto",
    ]);
  });
});

describe("feasibilityView", () => {
  it("without a calendar: not checked, never 'free'", () => {
    const v = feasibilityView(run([], []), false);
    expect(v).toMatchObject({ label: NOT_CHECKED_LABEL, tone: "muted", notChecked: true });
  });

  it("conflicts from manual commitments still lead without a calendar", () => {
    const v = feasibilityView(run([lunch], []), false);
    expect(v).toMatchObject({ label: "1 conflict found", tone: "bad", notChecked: true });
    expect(v.detail).toMatch(/No calendar is connected, so there may be more\.$/);
  });

  it("coverage incomplete is said in those words", () => {
    const short: CalendarCoverage[] = [{ ...covered[0], until: "2026-11-01" }];
    expect(feasibilityView(run([], short), true)).toMatchObject({ label: "Calendar coverage incomplete", tone: "warn" });
  });

  it("missing travel time needs confirmation; covered and known is no conflicts", () => {
    expect(feasibilityView(run([], covered, null), true).label).toBe("Needs confirmation");
    expect(feasibilityView(run([], covered), true)).toMatchObject({ label: "No conflicts found", tone: "ok" });
  });

  it("a strong warning keeps the headline from looking all clear", () => {
    const exam: Commitment = { ...lunch, id: "e", kind: "exam", title: "Final", start: "2026-11-15T14:00:00Z", end: "2026-11-15T16:00:00Z" };
    expect(feasibilityView(run([exam], covered), true)).toMatchObject({ label: "No time conflicts, 1 strong warning", tone: "warn" });
  });
});

describe("feasibilityFor", () => {
  it("uses the shortlist's travel override and flags overlaps with shortlisted events", async () => {
    const { buildStudentContext, feasibilityFor } = await import("./forOpportunity");
    const { addToShortlist, updateSaved } = await import("../shortlist");
    const a = makeOpportunity({ id: "a", name: "Maple Hacks" });
    const b = makeOpportunity({ id: "b", name: "Birch Jam", start: "2026-11-14T18:00:00-05:00", end: "2026-11-14T21:00:00-05:00" });
    const shortlist = updateSaved(addToShortlist(addToShortlist([], "a", NOW), "b", NOW), "a", { travelMinutesOverride: 90 });
    const ctx = buildStudentContext({
      profile: makeProfile({ travelMinutes: 20 }),
      calendar: { calendars: [], events: [] },
      manual: [],
      shortlist,
      opportunities: [a, b],
      timezone: "America/Toronto",
    });
    const f = feasibilityFor(a, ctx, NOW);
    expect(f.used).toMatchObject({ assumptions: { oneWayTravelMinutes: 90 }, travelSource: "this event" });
    expect(f.result.hardConflicts.map((c) => c.code)).toEqual(["shortlist-overlap"]);
    expect(f.view).toMatchObject({ label: "1 conflict found", notChecked: true });
  });
});
