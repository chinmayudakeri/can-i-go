import { PROGRAMS, type EligibilityRequirements, type Opportunity } from "./types";

/**
 * Runtime check for data coming from a source. It catches the mistakes that
 * would otherwise crash the UI or mislead a student (missing fields, bad or
 * impossible dates, wrong enums, malformed money) without duplicating every
 * type. Sources should call this before returning, and ingestion calls it
 * with `{ real: true }` before writing anything.
 */
export class InvalidOpportunityError extends Error {}

export interface ParseOptions {
  /**
   * Real listings must carry provenance: a source URL, a verification date,
   * and a supporting quote for every known date, deadline, eligibility and
   * cost field.
   */
  real?: boolean;
}

const TYPES = ["hackathon", "conference", "workshop", "competition", "career-fair", "meetup"];
const FORMATS = ["in-person", "online", "hybrid"];
const SUPPORT_LEVELS = ["full", "partial", "none"];
const ELIGIBILITY_KEYS: (keyof EligibilityRequirements)[] = [
  "studentStatusRequired",
  "universities",
  "programs",
  "years",
  "experienceLevels",
  "otherRequirements",
];
/** Fields that need a quote in real listings whenever their value is known. */
const REAL_EVIDENCE_FIELDS = [
  "start",
  "end",
  "applicationDeadline",
  "registrationFee",
  "travelCostEstimate",
  "lodgingSupport",
  "foodSupport",
  "travelSupport",
] as const;

/** ISO 8601 date-time with an explicit offset (or Z). */
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** True for a well-formed ISO date-time with offset that names a real moment in a sane range. */
export function isValidIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  if (y < MIN_YEAR || y > MAX_YEAR || !isRealCalendarDate(y, mo, d)) return false;
  if (h > 23 || mi > 59 || s > 59) return false;
  return !Number.isNaN(Date.parse(value));
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  return y >= MIN_YEAR && y <= MAX_YEAR && isRealCalendarDate(y, mo, d);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) && CURRENCIES.has(value);
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseOpportunities(raw: unknown, sourceName: string, options: ParseOptions = {}): Opportunity[] {
  if (!Array.isArray(raw)) {
    throw new InvalidOpportunityError(`${sourceName}: expected an array of opportunities.`);
  }
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const o = item as Record<string, unknown>;
    const where = `${sourceName}[${i}]${typeof o?.id === "string" ? ` (${o.id})` : ""}`;
    const fail = (msg: string): never => {
      throw new InvalidOpportunityError(`${where}: ${msg}`);
    };

    if (!o || typeof o !== "object" || Array.isArray(o)) fail("not an object");
    for (const key of ["id", "name", "organizer", "description", "officialUrl", "timezone", "sourceUrl", "lastVerified"]) {
      if (typeof o[key] !== "string" || !(o[key] as string).trim()) fail(`missing "${key}"`);
    }
    if (seen.has(o.id as string)) fail("duplicate id");
    seen.add(o.id as string);

    if (!TYPES.includes(o.type as string)) fail(`unknown type "${String(o.type)}"`);
    if (!FORMATS.includes(o.format as string)) fail(`unknown format "${String(o.format)}"`);
    if (o.format !== "online" && !o.location) fail("in-person/hybrid events need a location");
    if (o.location !== null && o.location !== undefined) {
      const loc = o.location as Record<string, unknown>;
      if (typeof loc !== "object" || typeof loc.city !== "string" || typeof loc.country !== "string") {
        fail('"location" needs a city and country');
      }
    }

    for (const key of ["officialUrl", "sourceUrl"]) if (!isHttpUrl(o[key])) fail(`"${key}" must be an http(s) URL`);
    if (o.applyUrl !== null && !isHttpUrl(o.applyUrl)) fail('"applyUrl" must be an http(s) URL or null');
    if (o.sourceUrls !== undefined && (!Array.isArray(o.sourceUrls) || !o.sourceUrls.every(isHttpUrl))) {
      fail('"sourceUrls" must be a list of http(s) URLs');
    }
    if (!isValidTimeZone(o.timezone)) fail(`invalid timezone "${String(o.timezone)}"`);
    if (!isValidIsoDate(o.lastVerified)) fail('invalid "lastVerified" date (expected YYYY-MM-DD)');

    for (const key of ["start", "end"]) {
      if (!isValidIsoDateTime(o[key])) fail(`invalid "${key}" date`);
    }
    if (Date.parse(o.end as string) < Date.parse(o.start as string)) fail("ends before it starts");
    if (o.applicationDeadline !== null) {
      if (!isValidIsoDateTime(o.applicationDeadline)) fail('invalid "applicationDeadline"');
      if (Date.parse(o.applicationDeadline as string) > Date.parse(o.end as string)) fail("deadline is after the event ends");
    }
    if (typeof o.exactCutoffUnknown !== "boolean") fail('"exactCutoffUnknown" must be true or false');

    if (!o.eligibility || typeof o.eligibility !== "object") fail('missing "eligibility"');
    const eligibility = o.eligibility as Record<string, unknown>;
    const programs = eligibility.programs;
    if (Array.isArray(programs)) {
      const unknown = programs.filter((p) => !(PROGRAMS as readonly unknown[]).includes(p));
      if (unknown.length) fail(`unknown program(s) ${unknown.map((p) => JSON.stringify(p)).join(", ")}; use values from PROGRAMS`);
    }

    for (const key of ["registrationFee", "travelCostEstimate"]) {
      const money = o[key] as Record<string, unknown> | null;
      if (money === null) continue;
      if (typeof money !== "object" || typeof money.amount !== "number" || !Number.isFinite(money.amount) || money.amount < 0) {
        fail(`"${key}" needs a non-negative amount`);
      }
      if (!isValidCurrency(money.currency)) fail(`"${key}" has an invalid currency "${String(money.currency)}"`);
    }
    for (const key of ["lodgingSupport", "foodSupport", "travelSupport"]) {
      if (o[key] !== null && !SUPPORT_LEVELS.includes(o[key] as string)) fail(`unknown "${key}" "${String(o[key])}"`);
    }
    if (o.teamSize !== null) {
      const t = o.teamSize as Record<string, unknown>;
      const ok =
        typeof t === "object" &&
        Number.isInteger(t.min) &&
        Number.isInteger(t.max) &&
        (t.min as number) >= 1 &&
        (t.min as number) <= (t.max as number);
      if (!ok) fail('"teamSize" needs whole numbers with 1 ≤ min ≤ max');
    }
    if (o.beginnerFriendly !== null && typeof o.beginnerFriendly !== "boolean") fail('"beginnerFriendly" must be true, false or null');

    if (!Array.isArray(o.tags)) fail('"tags" must be an array');
    if (!o.evidence || typeof o.evidence !== "object") fail('missing "evidence"');
    const evidence = o.evidence as Record<string, { quote?: unknown; sourceUrl?: unknown } | undefined>;
    for (const [field, ev] of Object.entries(evidence)) {
      if (!ev || typeof ev.quote !== "string" || !ev.quote.trim() || !isHttpUrl(ev.sourceUrl)) {
        fail(`evidence for "${field}" needs a quote and an http(s) sourceUrl`);
      }
    }

    if (options.real) {
      const needs = [
        ...REAL_EVIDENCE_FIELDS.filter((key) => o[key] !== null),
        ...ELIGIBILITY_KEYS.filter((key) => eligibility[key] !== null).map((key) => `eligibility.${key}`),
      ];
      const missing = needs.filter((field) => !evidence[field]);
      if (missing.length) fail(`real listing is missing evidence for ${missing.join(", ")}`);
    }

    return o as unknown as Opportunity;
  });
}
