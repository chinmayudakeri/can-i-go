import type { Opportunity } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeadlineStatus =
  | { kind: "unknown" }
  | { kind: "open"; deadline: Date; cutoffUnknown: boolean }
  /** Cutoff time is unknown and we're on the deadline day: it may already be closed. */
  | { kind: "uncertain"; deadline: Date }
  | { kind: "passed"; deadline: Date };

/**
 * When `exactCutoffUnknown` is set, `applicationDeadline` is the latest
 * plausible moment (end of day in the event timezone). We only call it
 * "passed" after that, and flag the preceding 24h as uncertain.
 */
export function getDeadlineStatus(opp: Opportunity, now: Date): DeadlineStatus {
  if (!opp.applicationDeadline) return { kind: "unknown" };
  const deadline = new Date(opp.applicationDeadline);
  if (Number.isNaN(deadline.getTime())) return { kind: "unknown" };

  const msLeft = deadline.getTime() - now.getTime();
  if (msLeft <= 0) return { kind: "passed", deadline };
  if (opp.exactCutoffUnknown && msLeft < DAY_MS) return { kind: "uncertain", deadline };
  return { kind: "open", deadline, cutoffUnknown: opp.exactCutoffUnknown };
}

export function isDeadlinePassed(opp: Opportunity, now: Date): boolean {
  return getDeadlineStatus(opp, now).kind === "passed";
}

/** Whole days remaining, rounded down. Only meaningful for open deadlines. */
export function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

/** Calendar date (YYYY-MM-DD) of an instant in a given IANA timezone. */
export function localDate(iso: string, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function isMultiDay(opp: Opportunity): boolean {
  return localDate(opp.start, opp.timezone) !== localDate(opp.end, opp.timezone);
}
