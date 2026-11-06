import { daysUntil, type DeadlineStatus } from "./deadline";
import type { EventFormat, Opportunity, OpportunityType, SupportLevel, Transport } from "./types";

export const TYPE_LABELS: Record<OpportunityType, string> = {
  hackathon: "Hackathon",
  conference: "Conference",
  workshop: "Workshop",
  competition: "Competition",
  "career-fair": "Career fair",
  meetup: "Meetup",
};

export const FORMAT_LABELS: Record<EventFormat, string> = {
  "in-person": "In person",
  online: "Online",
  hybrid: "Hybrid",
};

export const SUPPORT_LABELS: Record<SupportLevel, string> = {
  full: "Provided",
  partial: "Partly provided",
  none: "Not provided",
};

export const TRANSPORT_LABELS: Record<Transport, string> = {
  "walk-bike": "Walk / bike",
  transit: "Local transit",
  car: "Car",
  "train-bus": "Intercity train / bus",
  plane: "Plane",
};

/** Topics offered on the profile page. Event tags use the same vocabulary. */
export const TOPICS = [
  "AI",
  "Careers",
  "Climate",
  "Data science",
  "Design",
  "Fintech",
  "Game dev",
  "Hardware",
  "Health tech",
  "Robotics",
  "Security",
  "Web",
];

/** Date and time in the event's own timezone, with the zone shown. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
}

/** "devfest.example.org" from a URL, without "www.". */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatEventDates(opp: Opportunity): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: opp.timezone, month: "short", day: "numeric", year: "numeric" };
  const fmt = new Intl.DateTimeFormat("en-US", opts);
  return fmt.formatRange(new Date(opp.start), new Date(opp.end));
}

export const COUNTRY_NOT_STATED = "Country not stated";
export const TIMEZONE_CONFIRMED_LABEL = "Timezone confirmed by reviewer";

/** How a real listing's timezone was decided, for the detail page. Demo events have none. */
export function describeTimezoneSource(opp: Opportunity): { label: string; detail: string | null } | null {
  if (opp.dataset !== "real") return null;
  const c = opp.timezoneConfirmation;
  if (c) return { label: TIMEZONE_CONFIRMED_LABEL, detail: `on ${formatDate(`${c.confirmedOn}T12:00:00Z`, "UTC")}: ${c.note}` };
  return { label: "Derived from the stated location", detail: null };
}

export function formatPlace(opp: Opportunity): string {
  if (opp.format === "online" || !opp.location) return "Online";
  const { venue, city, region, country } = opp.location;
  const place = [city ?? venue, region].filter(Boolean).join(", ");
  const withCountry = country ? place : `${place} (${COUNTRY_NOT_STATED.toLowerCase()})`;
  return opp.format === "hybrid" ? `${withCountry} or online` : withCountry;
}

export function describeDeadline(d: DeadlineStatus, opp: Opportunity, now: Date): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  const when = (date: Date) => formatDateTime(date.toISOString(), opp.timezone);
  switch (d.kind) {
    case "unknown":
      return { text: "Deadline not published", tone: "muted" };
    case "passed":
      return { text: `Deadline passed (${formatDate(d.deadline.toISOString(), opp.timezone)})`, tone: "bad" };
    case "uncertain":
      return {
        text: `Closes ${formatDate(d.deadline.toISOString(), opp.timezone)}. Exact time unknown, so it may already be closed`,
        tone: "warn",
      };
    case "open": {
      const days = daysUntil(d.deadline, now);
      const left = days === 0 ? "less than a day left" : days === 1 ? "1 day left" : `${days} days left`;
      const date = d.cutoffUnknown ? `${formatDate(d.deadline.toISOString(), opp.timezone)} (exact time unknown)` : when(d.deadline);
      return { text: `Apply by ${date} · ${left}`, tone: days <= 3 ? "warn" : "ok" };
    }
  }
}
