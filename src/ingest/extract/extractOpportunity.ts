import { TOPICS } from "@/lib/format";
import type { EligibilityRequirements, EventFormat, Evidence, EvidenceField, Money, Opportunity, OpportunityType, SupportLevel } from "@/lib/types";
import { InvalidOpportunityError, parseOpportunities } from "@/lib/validate";
import { withBackoff } from "../backoff";
import type { CallBudget } from "../budget";
import { listingId } from "../dedupe";
import {
  checkBoolean,
  checkDate,
  checkLocation,
  checkMoney,
  checkOneOf,
  checkOtherRequirements,
  checkPrograms,
  checkRequirement,
  checkTeamSize,
  checkUrlInText,
  checkValueInQuote,
  quoteAppearsIn,
  verifyField,
  type Check,
  type ExtractedField,
  type FieldResult,
  type LocationValue,
} from "../evidence";
import { waterlooDate } from "../time";
import { finalizeDraft, localFull, validateDraft, type TimezoneDraft } from "../timezoneDraft";
import { deriveTimeZone, type TimeZoneDerivation } from "../timezones";
import { DERIVED_FROM_LOCATION, type FieldReport } from "../types";
import { prepareText } from "./prompt";
import { EVENT_FORMATS, EXPERIENCE_LEVELS, OPPORTUNITY_TYPES, STUDY_YEARS, SUPPORT_LEVELS } from "./schema";
import type { ExtractionProvider } from "./types";

export interface ExtractionResult {
  /** A validated real listing, or null if required facts were missing or invalid (or it needs a reviewer timezone). */
  opportunity: Opportunity | null;
  /** Set when everything verified except the timezone: the record waits for a reviewer to type it. */
  draft?: TimezoneDraft;
  needsReviewerTimezone?: true;
  /** Every field's outcome, for review. */
  fields: FieldReport[];
  rejectReason: string | null;
}

export interface ExtractOptions {
  provider: ExtractionProvider;
  budget: CallBudget;
  /** When the page was fetched (ISO); sets lastVerified. */
  fetchedAt: string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Asks the provider for field values, then keeps only what the page itself
 * supports. The provider call is the only AI involvement; every decision
 * after it is deterministic code.
 */
export async function extractOpportunity(text: string, sourceUrl: string, options: ExtractOptions): Promise<ExtractionResult> {
  const prepared = prepareText(text);
  const raw = await withBackoff(() => options.provider.extract({ text: prepared, sourceUrl }), {
    budget: options.budget,
    sleep: options.sleep,
  });
  return buildOpportunity(raw, prepared, sourceUrl, options.fetchedAt);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads one { value, quote, basis } field; anything else counts as missing. Unknown keys are ignored. */
function readField(v: unknown): ExtractedField<unknown> | undefined {
  if (!isObject(v) || !("value" in v)) return undefined;
  return {
    value: v.value ?? null,
    quote: typeof v.quote === "string" ? v.quote : null,
    basis: v.basis === "stated" || v.basis === "inferred" ? v.basis : null,
  };
}

/** A date field, plus its optional separate time-of-day fragment. */
function readDateField(v: unknown): (ExtractedField<unknown> & { timeQuote: string | null }) | undefined {
  const f = readField(v);
  if (!f) return undefined;
  const timeQuote = isObject(v) && typeof v.timeQuote === "string" && v.timeQuote.trim() ? v.timeQuote : null;
  return { ...f, timeQuote };
}

/** { openToAll, list } → "any" | list. */
function readRequirement(v: unknown): ExtractedField<unknown> | undefined {
  const f = readField(v);
  if (!f || f.value === null) return f;
  const value = isObject(f.value) ? (f.value.openToAll === true ? "any" : f.value.list) : f.value;
  return { ...f, value };
}

function toReport(field: string, r: FieldResult<unknown>): FieldReport {
  if (r.status === "kept") return { field, status: "kept", value: r.value, quote: r.quote, basis: r.basis, ...(r.note ? { reason: r.note } : {}) };
  if (r.status === "discarded") return { field, status: "discarded", value: r.proposed, quote: r.quote, basis: r.basis, reason: r.reason };
  return { field, status: "missing", value: null, quote: null, basis: null };
}

/** Pure: raw model output + the exact text it saw → verified record. Exported for tests. */
export function buildOpportunity(raw: unknown, text: string, sourceUrl: string, fetchedAt: string): ExtractionResult {
  const fields: FieldReport[] = [];
  const reject = (reason: string): ExtractionResult => ({ opportunity: null, fields, rejectReason: reason });

  let out = raw;
  if (typeof out === "string") {
    try {
      out = JSON.parse(out);
    } catch {
      return reject("model output is not valid JSON");
    }
  }
  if (!isObject(out)) return reject("model output is not a JSON object");
  if (out.isEvent === false) return reject("the page is not about one specific event");
  const eligibilityRaw = isObject(out.eligibility) ? out.eligibility : {};

  const evidence: Partial<Record<EvidenceField, Evidence>> = {};
  const results = new Map<string, FieldResult<unknown>>();
  function verify<T>(field: string, extracted: ExtractedField<unknown> | undefined, check?: (value: T, quote: string) => Check<T>): T | null {
    const r = verifyField<unknown>(field, extracted, { text, check: check as ((v: unknown, q: string) => Check<unknown>) | undefined });
    results.set(field, r);
    fields.push(toReport(field, r));
    return r.status === "kept" ? (r.value as T) : null;
  }
  const timeQuotesUsed = new Map<string, string>();
  const keepEvidence = (field: EvidenceField) => {
    const r = results.get(field);
    if (r?.status !== "kept") return;
    const timeQuote = timeQuotesUsed.get(field);
    evidence[field] = { quote: r.quote, sourceUrl, basis: r.basis, ...(timeQuote ? { timeQuote } : {}) };
  };
  const keptQuote = (field: string) => {
    const r = results.get(field);
    return r?.status === "kept" ? [r.quote] : [];
  };
  /** A date, whose time of day may come from a separate verified fragment and whose year may come from `yearFrom` fields. */
  function verifyDate(field: "start" | "end" | "applicationDeadline", raw: ReturnType<typeof readDateField>, yearFrom: string[]): string | null {
    const timeQuote = raw?.timeQuote ?? null;
    const verifiedTimeQuote = timeQuote && quoteAppearsIn(timeQuote, text) ? timeQuote : null;
    const yearContext = yearFrom.flatMap(keptQuote);
    const local = verify<string>(field, raw, (v, q) => checkDate(v, q, yearContext, verifiedTimeQuote));
    const report = fields[fields.length - 1];
    if (timeQuote) {
      report.timeQuote = timeQuote;
      if (!verifiedTimeQuote) report.reason = [report.reason, "time quote is not verbatim in one line of the page text"].filter(Boolean).join("; ");
    }
    if (report.status === "kept" && report.reason === "time from the separate time quote" && verifiedTimeQuote) timeQuotesUsed.set(field, verifiedTimeQuote);
    return local;
  }

  // Descriptive fields
  const name = verify<string>("name", readField(out.name), checkValueInQuote);
  const organizer = verify<string>("organizer", readField(out.organizer), checkValueInQuote);
  const description = verify<string>("description", readField(out.description), (_v, quote) => ({ ok: true, value: quote.trim().slice(0, 600) }));
  const type = verify<OpportunityType>("type", readField(out.type), checkOneOf(OPPORTUNITY_TYPES));
  const format = verify<EventFormat>("format", readField(out.format), checkOneOf(EVENT_FORMATS));
  const applyUrl = verify<string>("applyUrl", readField(out.applyUrl), checkUrlInText(text));
  const tags = verify<string[]>("tags", readField(out.tags), (v) => {
    const valid = Array.isArray(v) ? v.filter((t): t is string => (TOPICS as readonly string[]).includes(t)) : [];
    return valid.length ? { ok: true, value: [...new Set(valid)] } : { ok: false, reason: "no tags from the allowed list" };
  });
  const beginnerFriendly = verify<boolean>("beginnerFriendly", readField(out.beginnerFriendly), checkBoolean);
  const teamSize = verify<{ min: number; max: number }>("teamSize", readField(out.teamSize), checkTeamSize);
  const locationValue = format === "online" ? null : verify<LocationValue>("location", readField(out.location), checkLocation);
  if (locationValue) keepEvidence("location");

  // Timezone: derived in code from the verified location via a lookup table. The model is never asked.
  const derivation: TimeZoneDerivation =
    format === "online"
      ? { timezone: null, reason: "online event: no stated location to derive it from" }
      : locationValue
        ? deriveTimeZone(locationValue)
        : { timezone: null, reason: "the location was not verified" };
  const timezone = derivation.timezone;
  fields.push(
    derivation.timezone !== null
      ? { field: "timezone", status: "kept", value: derivation.timezone, quote: keptQuote("location")[0] ?? null, basis: DERIVED_FROM_LOCATION, reason: derivation.via }
      : { field: "timezone", status: "missing", value: null, quote: null, basis: null, reason: derivation.reason },
  );
  if (teamSize) keepEvidence("teamSize");
  if (beginnerFriendly !== null) keepEvidence("beginnerFriendly");

  // Dates. Start must state its own year; the end may borrow it from the verified start quote;
  // the deadline from the verified start or end quote.
  const startLocal = verifyDate("start", readDateField(out.start), []);
  const endLocal = verifyDate("end", readDateField(out.end), ["start"]);
  const deadlineLocal = verifyDate("applicationDeadline", readDateField(out.applicationDeadline), ["start", "end"]);

  // Eligibility
  const eligibility: EligibilityRequirements = {
    studentStatusRequired: verify<boolean>("eligibility.studentStatusRequired", readField(eligibilityRaw.studentStatusRequired), checkBoolean),
    universities: verify<string[] | "any">("eligibility.universities", readRequirement(eligibilityRaw.universities), checkRequirement(null)),
    programs: verify("eligibility.programs", readRequirement(eligibilityRaw.programs), checkPrograms),
    years: verify("eligibility.years", readRequirement(eligibilityRaw.years), checkRequirement(STUDY_YEARS)),
    experienceLevels: verify("eligibility.experienceLevels", readRequirement(eligibilityRaw.experienceLevels), checkRequirement(EXPERIENCE_LEVELS)),
    otherRequirements: verify<string[]>("eligibility.otherRequirements", readField(eligibilityRaw.otherRequirements), checkOtherRequirements(text)),
  };
  for (const key of Object.keys(eligibility) as (keyof EligibilityRequirements)[]) keepEvidence(`eligibility.${key}`);

  // Costs and support
  const registrationFee = verify<Money>("registrationFee", readField(out.registrationFee), checkMoney);
  const travelCostEstimate = verify<Money>("travelCostEstimate", readField(out.travelCostEstimate), checkMoney);
  const lodgingSupport = verify<SupportLevel>("lodgingSupport", readField(out.lodgingSupport), checkOneOf(SUPPORT_LEVELS));
  const foodSupport = verify<SupportLevel>("foodSupport", readField(out.foodSupport), checkOneOf(SUPPORT_LEVELS));
  const travelSupport = verify<SupportLevel>("travelSupport", readField(out.travelSupport), checkOneOf(SUPPORT_LEVELS));
  for (const key of ["registrationFee", "travelCostEstimate", "lodgingSupport", "foodSupport", "travelSupport"] as const) keepEvidence(key);

  // Required facts: without these there is no listing.
  const missing = [
    !name && "name",
    !type && "type",
    !format && "format",
    !timezone && "timezone",
    !startLocal && "start",
    !endLocal && "end",
    format && format !== "online" && !locationValue && "location",
  ].filter((m): m is string => Boolean(m));
  // The one exception: if the timezone is the ONLY missing fact, the record waits for a reviewer to
  // type the zone (see timezoneDraft.ts). Every other gap still rejects.
  const onlyTimezoneMissing = missing.length === 1 && missing[0] === "timezone";
  if (missing.length && !onlyTimezoneMissing) return reject(`required fields missing or unverified: ${missing.join(", ")}`);

  // Order checks in local time: start and end share the event's zone, so no zone is needed.
  if (localFull(endLocal!, "23:59:59") < localFull(startLocal!, "00:00:00")) return reject(`end (${endLocal}) is before start (${startLocal})`);
  keepEvidence("start");
  keepEvidence("end");
  let keptDeadline: string | null = null;
  if (deadlineLocal) {
    if (localFull(deadlineLocal, "23:59:59") > localFull(endLocal!, "23:59:59")) {
      const report = fields.find((f) => f.field === "applicationDeadline")!;
      Object.assign(report, { status: "discarded", reason: "deadline is after the event ends" });
    } else {
      keptDeadline = deadlineLocal;
      keepEvidence("applicationDeadline");
    }
  }

  const draft: TimezoneDraft = {
    name: name!,
    organizer: organizer ?? "Unknown",
    type: type!,
    description: description ?? "No description stated by the source.",
    // Always the fetched page, set here rather than proposed by the model.
    officialUrl: sourceUrl,
    applyUrl,
    format: format!,
    location: locationValue,
    startLocal: startLocal!,
    endLocal: endLocal!,
    deadlineLocal: keptDeadline,
    eligibility,
    teamSize,
    registrationFee,
    travelCostEstimate,
    lodgingSupport,
    foodSupport,
    travelSupport,
    tags: tags ?? [],
    beginnerFriendly,
    sourceUrl,
    sourceUrls: [sourceUrl],
    lastVerified: waterlooDate(fetchedAt),
    evidence,
  };

  try {
    if (onlyTimezoneMissing) {
      validateDraft(draft, "extraction");
      return { opportunity: null, draft, needsReviewerTimezone: true, fields, rejectReason: null };
    }
    const opportunity = finalizeDraft(draft, timezone!);
    parseOpportunities([opportunity], "extraction", { real: true });
    return { opportunity, fields, rejectReason: null };
  } catch (err) {
    if (err instanceof InvalidOpportunityError) return reject(err.message);
    throw err;
  }
}
