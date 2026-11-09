"use client";

import { useEffect, useMemo, useState } from "react";
import { browserTimezone } from "@/lib/feasibility/assumptions";
import { buildStudentContext, type StudentContext } from "@/lib/feasibility/forOpportunity";
import type { Opportunity, StudentProfile } from "@/lib/types";
import { useCalendarData } from "./useCalendarData";
import { useCalendarEnabled } from "./useCalendarEnabled";
import { useShortlist } from "./useShortlist";

export type StudentContextState =
  | { status: "loading" }
  /** "Use my calendar" is off: no context, and no feasibility checks run. */
  | { status: "off" }
  | { status: "ready"; ctx: StudentContext; calendarError: string | null; shortlistError: string | null };

/**
 * Calendar, commitments and shortlist from this browser, ready for
 * feasibility checks. Storage errors are passed on, never treated as "free".
 */
export function useStudentContext(opportunities: Opportunity[], profile: StudentProfile | null) {
  const toggle = useCalendarEnabled();
  const calendar = useCalendarData();
  const shortlist = useShortlist();
  // Read after mount: the server render can't know the browser's timezone.
  const [timezone, setTimezone] = useState<string | null>(null);
  useEffect(() => setTimezone(browserTimezone()), []);

  const state = useMemo<StudentContextState>(() => {
    if (!toggle.ready) return { status: "loading" };
    if (!toggle.enabled) return { status: "off" };
    if (calendar.state.status === "loading" || shortlist.state.status === "loading" || !timezone) return { status: "loading" };
    const ready = calendar.state.status === "ready" ? calendar.state : null;
    return {
      status: "ready",
      ctx: buildStudentContext({
        profile,
        calendar: ready?.store ?? { calendars: [], events: [] },
        manual: ready?.commitments ?? [],
        shortlist: shortlist.list,
        opportunities,
        timezone,
      }),
      calendarError: calendar.state.status === "error" ? calendar.state.error : null,
      shortlistError: shortlist.state.status === "error" ? shortlist.state.error : null,
    };
  }, [toggle.ready, toggle.enabled, calendar.state, shortlist.state, shortlist.list, timezone, profile, opportunities]);

  return { state, shortlist };
}
