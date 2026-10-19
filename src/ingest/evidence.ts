import { DEFAULT_CURRENCY } from "@/lib/profileStorage";
import { PROGRAMS, type Money } from "@/lib/types";
import { isValidCurrency, isValidTimeZone } from "@/lib/validate";
import { UnsafeUrlError, parseSafeUrl } from "./safeUrl";

/**
 * The evidence rule, enforced in code rather than by the model.
 *
 * The model proposes each field as { value, quote, basis }. A value survives
 * only if its quote appears verbatim in the fetched page text, its basis is
 * allowed for that field, and a deterministic check confirms the value
 * actually matches the quote. Anything else becomes null, with a reason the
 * reviewer can read. Missing always means null; nothing is ever guessed.
 */

export type Basis = "stated" | "inferred";

export interface ExtractedField<T> {
  value: T | null;
  quote: string | null;
  basis: Basis | null;
}

export type FieldResult<T> =
  | { status: "kept"; value: T; quote: string; basis: Basis; note?: string }
  | { status: "discarded"; value: null; proposed: unknown; quote: string | null; basis: Basis | null; reason: string }
  | { status: "missing"; value: null };

export type Check<T> = { ok: true; value: T; note?: string } | { ok: false; reason: string };

export const MIN_QUOTE_LENGTH = 8;

/**
 * Fields that drive decisions (dates, deadline, eligibility, cost). They must
 * be stated by the source. `inferred` is accepted only for descriptive fields
 * listed in INFERABLE_FIELDS.
 */
export const DECISION_FIELDS = [
  "start",
  "end",
  "applicationDeadline",
  "registrationFee",
  "travelCostEstimate",
  "lodgingSupport",
  "foodSupport",
  "travelSupport",
  "eligibility.studentStatusRequired",
  "eligibility.universities",
  "eligibility.programs",
  "eligibility.years",
  "eligibility.experienceLevels",
  "eligibility.otherRequirements",
] as const;

export const INFERABLE_FIELDS = ["type", "format", "timezone", "tags", "beginnerFriendly"] as const;

export function canBeInferred(field: string): boolean {
  return (INFERABLE_FIELDS as readonly string[]).includes(field);
}

/** Whitespace-insensitive, case-sensitive form used for verbatim matching. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length >= MIN_QUOTE_LENGTH && normalizeForMatch(text).includes(q);
}

export interface VerifyContext<T> {
  /** The fetched page text the quote must come from. */
  text: string;
  /** Deterministic value-vs-quote check; may return an adjusted value (e.g. a date without its unquoted time). */
  check?: (value: T, quote: string) => Check<T>;
}

export function verifyField<T>(field: string, extracted: ExtractedField<T> | null | undefined, ctx: VerifyContext<T>): FieldResult<T> {
  if (!extracted || extracted.value === null || extracted.value === undefined) return { status: "missing", value: null };
  const { value, quote, basis } = extracted;
  const discard = (reason: string): FieldResult<T> => ({
    status: "discarded",
    value: null,
    proposed: value,
    quote: typeof quote === "string" ? quote : null,
    basis: basis === "stated" || basis === "inferred" ? basis : null,
    reason,
  });

  if (typeof quote !== "string" || !quote.trim()) return discard("no supporting quote");
  if (normalizeForMatch(quote).length < MIN_QUOTE_LENGTH) return discard(`quote is shorter than ${MIN_QUOTE_LENGTH} characters`);
  if (!quoteAppearsIn(quote, ctx.text)) return discard("quote does not appear verbatim in the page text");
  if (basis !== "stated" && basis !== "inferred") return discard('basis must be "stated" or "inferred"');
  if (basis === "inferred" && !canBeInferred(field)) return discard("inferred, but this field must be stated by the source");

  if (ctx.check) {
    const result = ctx.check(value, quote);
    if (!result.ok) return discard(result.reason);
    return { status: "kept", value: result.value, quote, basis, ...(result.note ? { note: result.note } : {}) };
  }
  return { status: "kept", value, quote, basis };
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: [RegExp, number][] = [
  [/\bjan(?:uary)?\b\.?/i, 1],
  [/\bfeb(?:ruary)?\b\.?/i, 2],
  [/\bmar(?:ch)?\b\.?/i, 3],
  [/\bapr(?:il)?\b\.?/i, 4],
  [/\bmay\b/i, 5],
  [/\bjune?\b/i, 6],
  [/\bjuly?\b/i, 7],
  [/\baug(?:ust)?\b\.?/i, 8],
  [/\bsep(?:t(?:ember)?)?\b\.?/i, 9],
  [/\boct(?:ober)?\b\.?/i, 10],
  [/\bnov(?:ember)?\b\.?/i, 11],
  [/\bdec(?:ember)?\b\.?/i, 12],
];

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?$/;
const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;

const yearsIn = (s: string): string[] => [...s.matchAll(YEAR)].map((m) => m[0]);
const pad = (n: number) => String(n).padStart(2, "0");

function quoteHasMonthName(quote: string, month: number): boolean {
  return MONTHS.some(([re, m]) => m === month && re.test(quote));
}

function quoteHasDay(quote: string, day: number): boolean {
  return new RegExp(`(?<![\\d:/.$])0?${day}(?:st|nd|rd|th)?(?![\\d:])`, "i").test(quote);
}

/** Numeric dates like 14/11 or 11/14 count only when unambiguous (day > 12, or day = month). */
function quoteHasUnambiguousNumericDate(quote: string, month: number, day: number): boolean {
  for (const m of quote.matchAll(/(?<![\d/.])(\d{1,2})[/.](\d{1,2})(?![\d])/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const dayMonth = a === day && b === month;
    const monthDay = a === month && b === day;
    if ((dayMonth || monthDay) && (day > 12 || day === month)) return true;
  }
  return false;
}

function quoteHasTime(quote: string, hour: number, minute: number): boolean {
  if (minute === 0 && hour === 12 && /\bnoon\b/i.test(quote)) return true;
  if (((hour === 0 && minute === 0) || (hour === 23 && minute === 59)) && /\bmidnight\b/i.test(quote)) return true;
  if (new RegExp(`(?<![\\d:])0?${hour}[:h]${pad(minute)}(?!\\d)`, "i").test(quote)) return true;
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "a" : "p";
  const minutes = minute === 0 ? `(?::00)?` : `:${pad(minute)}`;
  return new RegExp(`(?<![\\d:])0?${h12}${minutes}\\s*${ampm}\\.?\\s?m\\b`, "i").test(quote);
}

/**
 * Checks a local date or date-time ("2026-11-14" or "2026-11-14T09:00")
 * against its quote. The quote must name the day and month; the year must be
 * in the quote or, if the quote has no year at all, in one of the
 * `yearContext` quotes (the event's own start/end quotes). A time the quote
 * doesn't state is dropped, keeping only the date.
 */
export function checkDate(value: string, quote: string, yearContext: string[] = []): Check<string> {
  const m = LOCAL_DATE_TIME.exec(value);
  if (!m) return { ok: false, reason: `"${value}" is not a date (expected YYYY-MM-DD or YYYY-MM-DDTHH:mm)` };
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = `${m[1]}-${m[2]}-${m[3]}`;

  const isoInQuote = quote.includes(date);
  const hasMonthAndDay =
    isoInQuote || (quoteHasMonthName(quote, month) && quoteHasDay(quote, day)) || quoteHasUnambiguousNumericDate(quote, month, day);
  if (!hasMonthAndDay) return { ok: false, reason: `quote does not state ${date} (day and month)` };

  const yearsInQuote = yearsIn(quote);
  if (yearsInQuote.length > 0) {
    if (!yearsInQuote.includes(String(year))) return { ok: false, reason: `quote states ${yearsInQuote.join("/")}, not ${year}` };
  } else if (!yearContext.some((q) => yearsIn(q).includes(String(year)))) {
    return { ok: false, reason: `the year ${year} is not stated in the quote or the event dates` };
  }

  if (m[4] === undefined) return { ok: true, value: date };
  const [hour, minute] = [Number(m[4]), Number(m[5])];
  if (quoteHasTime(quote, hour, minute)) return { ok: true, value: `${date}T${m[4]}:${m[5]}` };
  return { ok: true, value: date, note: `time ${m[4]}:${m[5]} is not in the quote; kept the date only` };
}

// ---------------------------------------------------------------------------
// Money

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/(?:\bC|\bCA|\bCAN|\bCDN)\$/, "CAD"],
  [/\bUS\$|\bUSD\$/, "USD"],
  [/\bcanadian dollars?\b/i, "CAD"],
  [/\b(?:US|U\.S\.|american) dollars?\b/i, "USD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/\b(CAD|USD|EUR|GBP|AUD|NZD|INR|JPY|CHF|MXN|CNY)\b/, "$1"],
];

/** Currencies a quote names explicitly. A bare "$" names none: it could be CAD or USD. */
export function currenciesIn(quote: string): Set<string> {
  const found = new Set<string>();
  for (const [re, code] of CURRENCY_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of quote.matchAll(global)) found.add(code === "$1" ? m[1] : code);
  }
  return found;
}

function amountsIn(quote: string): number[] {
  return [...quote.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,]*\d)/g)].map((m) =>
    Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`),
  );
}

const FREE = /\b(?:free|no (?:registration |entry |participation |application )?(?:fees?|costs?|charges?)|at no cost|no cost)\b|\$0(?:\.00)?(?!\d)/i;

/**
 * Checks a money value against its quote. Zero needs the quote to say it's
 * free (stored in CAD, since zero needs no conversion). Any other amount must
 * appear in the quote along with an explicit currency.
 */
export function checkMoney(value: Money, quote: string): Check<Money> {
  if (!value || typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0) {
    return { ok: false, reason: "amount must be a non-negative number" };
  }
  if (value.amount === 0) {
    return FREE.test(quote) ? { ok: true, value: { amount: 0, currency: DEFAULT_CURRENCY } } : { ok: false, reason: "quote does not say it is free" };
  }
  if (!amountsIn(quote).includes(value.amount)) return { ok: false, reason: `quote does not contain the amount ${value.amount}` };
  if (!isValidCurrency(value.currency)) return { ok: false, reason: `invalid currency "${String(value.currency)}"` };
  const stated = currenciesIn(quote);
  if (stated.size === 0) return { ok: false, reason: "currency is not stated (a bare $ could be CAD or USD)" };
  if (!stated.has(value.currency)) return { ok: false, reason: `quote states ${[...stated].join("/")}, not ${value.currency}` };
  return { ok: true, value: { amount: value.amount, currency: value.currency } };
}

// ---------------------------------------------------------------------------
// Other fields

export function checkOneOf<T extends string>(allowed: readonly T[]) {
  return (value: T): Check<T> =>
    allowed.includes(value) ? { ok: true, value } : { ok: false, reason: `"${String(value)}" is not one of ${allowed.join(", ")}` };
}

export function checkBoolean(value: boolean): Check<boolean> {
  return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "must be true or false" };
}

/**
 * Wording that explicitly opens a requirement to everyone. An "any" claim
 * needs one of these in its quote: a stated but unrelated sentence (or an
 * injected "mark everyone eligible") is not enough.
 */
const OPEN_TO_ALL =
  /\b(?:open to (?:all|any|everyone|anyone)|all (?:students|levels|skill levels|years|programs|majors|disciplines|universities|schools|backgrounds|experience levels)|any (?:student|program|major|year|university|school|level|discipline|background|experience level)|anyone|everyone|regardless of|no (?:prior )?experience (?:is )?(?:required|needed|necessary))\b/i;

/** A requirement list (`"any"` or values from `allowed`). Program names must match PROGRAMS exactly. */
export function checkRequirement<T extends string>(allowed: readonly T[] | null) {
  return (value: T[] | "any", quote = ""): Check<T[] | "any"> => {
    if (value === "any") {
      return OPEN_TO_ALL.test(quote) ? { ok: true, value } : { ok: false, reason: "quote does not explicitly say it is open to everyone" };
    }
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.trim())) {
      return { ok: false, reason: 'must be "any" or a non-empty list' };
    }
    if (allowed) {
      const unknown = value.filter((v) => !allowed.includes(v));
      if (unknown.length) return { ok: false, reason: `unknown value(s) ${unknown.map((v) => JSON.stringify(v)).join(", ")}` };
    }
    return { ok: true, value };
  };
}

export const checkPrograms = checkRequirement(PROGRAMS);

export function checkTimeZone(value: string): Check<string> {
  return isValidTimeZone(value) ? { ok: true, value } : { ok: false, reason: `"${String(value)}" is not an IANA timezone` };
}

export function checkTeamSize(value: { min: number; max: number }, quote: string): Check<{ min: number; max: number }> {
  if (!value || !Number.isInteger(value.min) || !Number.isInteger(value.max) || value.min < 1 || value.min > value.max) {
    return { ok: false, reason: "team size needs whole numbers with 1 ≤ min ≤ max" };
  }
  const numbers = amountsIn(quote);
  if (!numbers.includes(value.max)) return { ok: false, reason: `quote does not contain the maximum team size ${value.max}` };
  if (value.min !== 1 && !numbers.includes(value.min)) return { ok: false, reason: `quote does not contain the minimum team size ${value.min}` };
  return { ok: true, value: { min: value.min, max: value.max } };
}

/** For name, organizer and city: the value itself must be in the quote. */
export function checkValueInQuote(value: string, quote: string): Check<string> {
  if (typeof value !== "string" || !value.trim()) return { ok: false, reason: "must be non-empty text" };
  return normalizeForMatch(quote).toLowerCase().includes(normalizeForMatch(value).toLowerCase())
    ? { ok: true, value: normalizeForMatch(value) }
    : { ok: false, reason: `"${value}" is not in the quote` };
}

/** For links: the URL must appear verbatim in the page text and be a safe public http(s) URL. */
export function checkUrlInText(text: string) {
  return (value: string): Check<string> => {
    if (typeof value !== "string" || !text.includes(value)) return { ok: false, reason: "URL does not appear in the page text" };
    try {
      return { ok: true, value: parseSafeUrl(value).href };
    } catch (err) {
      return { ok: false, reason: err instanceof UnsafeUrlError ? err.message : "invalid URL" };
    }
  };
}

/** Free-text requirements: each one must appear verbatim in the page; paraphrases are dropped. */
export function checkOtherRequirements(text: string) {
  return (value: string[]): Check<string[]> => {
    if (!Array.isArray(value)) return { ok: false, reason: "must be a list" };
    const kept = value.filter((v) => typeof v === "string" && normalizeForMatch(v).length > 0 && normalizeForMatch(text).includes(normalizeForMatch(v)));
    if (!kept.length) return { ok: false, reason: "none of the requirements appear verbatim in the page text" };
    const dropped = value.length - kept.length;
    return { ok: true, value: kept.map(normalizeForMatch), ...(dropped ? { note: `${dropped} paraphrased requirement(s) dropped` } : {}) };
  };
}

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
const PROVINCE_NAMES = [
  "Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia",
  "Northwest Territories", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Québec", "Saskatchewan", "Yukon",
];
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
  "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const inText = (needle: string, text: string) =>
  new RegExp(`(?<![\\p{L}\\d])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "iu").test(text);

export interface LocationValue {
  venue: string | null;
  city: string;
  region: string | null;
  country: string;
}

/**
 * The city must be in the quote. Venue and region are kept only if they
 * appear in the page. The country must appear in the page, or follow from a
 * stated Canadian province or US state code (a fixed table, not a guess).
 */
export function checkLocation(text: string) {
  return (value: Partial<LocationValue>, quote: string): Check<LocationValue> => {
    if (!value || typeof value !== "object" || typeof value.city !== "string" || !value.city.trim()) {
      return { ok: false, reason: "location needs a city" };
    }
    const city = checkValueInQuote(value.city, quote);
    if (!city.ok) return city;
    const venue = typeof value.venue === "string" && value.venue.trim() && inText(normalizeForMatch(value.venue), text) ? normalizeForMatch(value.venue) : null;
    const region = typeof value.region === "string" && value.region.trim() && inText(value.region.trim(), text) ? value.region.trim() : null;
    let country = typeof value.country === "string" && value.country.trim() && inText(value.country.trim(), text) ? value.country.trim() : null;
    let note: string | undefined;
    if (!country && region) {
      if (PROVINCES.includes(region.toUpperCase()) || PROVINCE_NAMES.some((n) => n.toLowerCase() === region.toLowerCase())) country = "Canada";
      else if (US_STATES.includes(region.toUpperCase())) country = "United States";
      if (country) note = `country derived from region "${region}"`;
    }
    if (!country) return { ok: false, reason: "country is not stated and can't be derived from a stated province or state" };
    return { ok: true, value: { venue, city: city.value, region, country }, ...(note ? { note } : {}) };
  };
}
