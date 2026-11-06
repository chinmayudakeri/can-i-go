import type { Opportunity, TimezoneConfirmation } from "@/lib/types";
import { isHttpUrl, parseOpportunities } from "@/lib/validate";
import { listingIdFromDate } from "./dedupe";
import { localToIso, waterlooDate } from "./time";

/**
 * The reviewer-confirmed timezone path. When every required fact verifies
 * except the timezone (the location doesn't say enough to derive it), the
 * record waits in pending as a draft with its verified LOCAL times. It
 * becomes a listing only when a reviewer types an IANA zone and says how
 * they checked it. Nothing here guesses or fills in a zone.
 */

export const NEEDS_REVIEWER_TIMEZONE = "needs reviewer timezone";
export const CONFIRMED_BY_REVIEWER = "confirmed by reviewer";
export { TIMEZONE_CONFIRMED_LABEL } from "@/lib/format";

/** Everything verified, except that times are local wall-clock strings ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"). */
export type TimezoneDraft = Omit<Opportunity, "id" | "timezone" | "start" | "end" | "applicationDeadline" | "exactCutoffUnknown" | "timezoneConfirmation"> & {
  startLocal: string;
  endLocal: string;
  deadlineLocal: string | null;
};

export class ReviewInputError extends Error {}

/** "YYYY-MM-DD" → that day at `fallback`; "YYYY-MM-DDTHH:mm" → with seconds. Comparable as strings within one zone. */
export function localFull(local: string, fallback: string): string {
  return local.includes("T") ? `${local}:00`.slice(0, 19) : `${local}T${fallback}`;
}

export function draftId(draft: Pick<TimezoneDraft, "name" | "startLocal">): string {
  return listingIdFromDate(draft.name, draft.startLocal.slice(0, 10));
}

const IANA_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

/** The reviewer's zone must be a real IANA name from the runtime's zone list (not "EST" or "Toronto"). */
export function validateReviewerTimezone(input: unknown): string {
  const zone = typeof input === "string" ? input.trim() : "";
  if (!zone) throw new ReviewInputError("enter an IANA timezone, e.g. America/Toronto");
  if (!IANA_ZONES.has(zone)) throw new ReviewInputError(`"${zone}" is not an IANA timezone (e.g. America/Toronto, America/Vancouver)`);
  return zone;
}

/** A short note or URL saying how the zone was verified. URLs must be http(s). */
export function validateReviewerNote(input: unknown): string {
  const note = typeof input === "string" ? input.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim() : "";
  if (note.length < 8) throw new ReviewInputError("add a short note or URL (at least 8 characters) saying how you verified the timezone");
  if (note.length > 500) throw new ReviewInputError("keep the note under 500 characters");
  if (/^[a-z][a-z0-9+.-]*:/i.test(note) && !/^https?:\/\//i.test(note)) throw new ReviewInputError("only http(s) links are allowed in the note");
  if (/^https?:\/\//i.test(note) && !isHttpUrl(note.split(/\s/)[0])) throw new ReviewInputError("that link isn't a valid URL");
  return note;
}

/**
 * Draft + zone → Opportunity. Date-only start/end cover the whole day; a
 * date-only deadline is end of day with exactCutoffUnknown, as for derived zones.
 */
export function finalizeDraft(draft: TimezoneDraft, timezone: string, confirmation?: TimezoneConfirmation): Opportunity {
  const toIso = (local: string, fallback: string) => {
    const full = localFull(local, fallback);
    return localToIso(full.slice(0, 10), full.slice(11), timezone);
  };
  const { startLocal, endLocal, deadlineLocal, ...rest } = draft;
  return {
    ...rest,
    id: draftId(draft),
    timezone,
    start: toIso(startLocal, "00:00:00"),
    end: toIso(endLocal, "23:59:59"),
    applicationDeadline: deadlineLocal ? toIso(deadlineLocal, "23:59:59") : null,
    exactCutoffUnknown: deadlineLocal ? !deadlineLocal.includes("T") : false,
    ...(confirmation ? { timezoneConfirmation: confirmation } : {}),
  };
}

/**
 * Validates a draft's structure (every field except the timezone) by
 * converting it with UTC purely as a probe. The probe result is discarded and
 * never stored; the real zone only ever comes from the reviewer.
 */
export function validateDraft(draft: TimezoneDraft, where: string): void {
  if (typeof draft?.startLocal !== "string" || typeof draft.endLocal !== "string") throw new ReviewInputError(`${where}: draft needs local start and end`);
  parseOpportunities([finalizeDraft(draft, "Etc/UTC")], where, { real: true });
}

/** Turns a flagged draft into a listing with the reviewer's zone and note. Throws ReviewInputError on bad input. */
export function confirmTimezone(draft: TimezoneDraft, input: { timezone: unknown; note: unknown; now?: Date }): Opportunity {
  const timezone = validateReviewerTimezone(input.timezone);
  const note = validateReviewerNote(input.note);
  const confirmedOn = waterlooDate((input.now ?? new Date()).toISOString());
  const opportunity = finalizeDraft(draft, timezone, { basis: CONFIRMED_BY_REVIEWER, note, confirmedOn });
  parseOpportunities([opportunity], "confirmed listing", { real: true });
  return opportunity;
}
