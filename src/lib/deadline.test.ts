import { describe, expect, it } from "vitest";
import { getDeadlineStatus, isDeadlinePassed, isMultiDay } from "./deadline";
import { NOW, makeOpportunity } from "./testFixtures";

describe("getDeadlineStatus", () => {
  it("is open before the deadline", () => {
    const s = getDeadlineStatus(makeOpportunity({ applicationDeadline: "2026-11-01T23:59:00-05:00" }), NOW);
    expect(s.kind).toBe("open");
  });

  it("is passed after the deadline", () => {
    const opp = makeOpportunity({ applicationDeadline: "2026-10-05T23:59:00-04:00" });
    expect(getDeadlineStatus(opp, NOW).kind).toBe("passed");
    expect(isDeadlinePassed(opp, NOW)).toBe(true);
  });

  it("is passed at the exact deadline instant", () => {
    const opp = makeOpportunity({ applicationDeadline: NOW.toISOString() });
    expect(isDeadlinePassed(opp, NOW)).toBe(true);
  });

  it("is unknown when no deadline is published, and never counts as passed", () => {
    const opp = makeOpportunity({ applicationDeadline: null });
    expect(getDeadlineStatus(opp, NOW).kind).toBe("unknown");
    expect(isDeadlinePassed(opp, NOW)).toBe(false);
  });

  it("is uncertain on the deadline day when the cutoff time is unknown", () => {
    const opp = makeOpportunity({ applicationDeadline: "2026-10-17T23:59:59-04:00", exactCutoffUnknown: true });
    expect(getDeadlineStatus(opp, NOW).kind).toBe("uncertain");
  });

  it("is open (but flagged) earlier when the cutoff time is unknown", () => {
    const opp = makeOpportunity({ applicationDeadline: "2026-11-20T23:59:59-05:00", exactCutoffUnknown: true });
    expect(getDeadlineStatus(opp, NOW)).toMatchObject({ kind: "open", cutoffUnknown: true });
  });

  it("treats an unparseable deadline as unknown", () => {
    expect(getDeadlineStatus(makeOpportunity({ applicationDeadline: "soon" }), NOW).kind).toBe("unknown");
  });
});

describe("isMultiDay", () => {
  it("uses the event's own timezone", () => {
    // 20:00–23:00 in New York is one local day, even though it crosses midnight UTC.
    const opp = makeOpportunity({ start: "2026-11-14T20:00:00-05:00", end: "2026-11-14T23:00:00-05:00" });
    expect(isMultiDay(opp)).toBe(false);
  });

  it("detects events spanning several days", () => {
    expect(isMultiDay(makeOpportunity({ end: "2026-11-15T17:00:00-05:00" }))).toBe(true);
  });
});
