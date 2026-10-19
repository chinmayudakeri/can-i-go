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
  checkTimeZone,
  checkUrlInText,
  checkValueInQuote,
  quoteAppearsIn,
  verifyField,
  type Check,
  type ExtractedField,
  type FieldResult,
  type LocationValue,
} from "../evidence";
import { localToIso, waterlooDate } from "../time";
import type { FieldReport } from "../types";
import { prepareText } from "./prompt";
import { EVENT_FORMATS, EXPERIENCE_LEVELS, OPPORTUNITY_TYPES, STUDY_YEARS, SUPPORT_LEVELS } from "./schema";
import type { ExtractionProvider } from "./types";

export interface ExtractionResult {
  /** A validated real listing, or null if required facts were missing or invalid. */
  opportunity: Opportunity | null;
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
  const keepEvidence = (field: EvidenceField) => {
    const r = results.get(field);
    if (r?.status === "kept") evidence[field] = { quote: r.quote, sourceUrl, basis: r.basis };
  };

  // Descriptive fields
  const name = verify<string>("name", readField(out.name), checkValueInQuote);
  const organizer = verify<string>("organizer", readField(out.organizer), checkValueInQuote);
  const description = verify<string>("description", readField(out.description), (_v, quote) => ({ ok: true, value: quote.trim().slice(0, 600) }));
  const type = verify<OpportunityType>("type", readField(out.type), checkOneOf(OPPORTUNITY_TYPES));
  const format = verify<EventFormat>("format", readField(out.format), checkOneOf(EVENT_FORMATS));
  const timezone = verify<string>("timezone", readField(out.timezone), checkTimeZone);
  const officialUrl = verify<string>("officialUrl", readField(out.officialUrl), checkUrlInText(text));
  const applyUrl = verify<string>("applyUrl", readField(out.applyUrl), checkUrlInText(text));
  const tags = verify<string[]>("tags", readField(out.tags), (v) => {
    const valid = Array.isArray(v) ? v.filter((t): t is string => (TOPICS as readonly string[]).includes(t)) : [];
    return valid.length ? { ok: true, value: [...new Set(valid)] } : { ok: false, reason: "no tags from the allowed list" };
  });
  const beginnerFriendly = verify<boolean>("beginnerFriendly", readField(out.beginnerFriendly), checkBoolean);
  const teamSize = verify<{ min: number; max: number }>("teamSize", readField(out.teamSize), checkTeamSize);
  const locationValue = format === "online" ? null : verify<LocationValue>("location", readField(out.location), checkLocation(text));
  if (locationValue) keepEvidence("location");
  if (teamSize) keepEvidence("teamSize");
  if (beginnerFriendly !== null) keepEvidence("beginnerFriendly");

  // Dates: the year may come from the event's own start/end quotes.
  const startRaw = readField(out.start);
  const endRaw = readField(out.end);
  const yearContext = [startRaw?.quote, endRaw?.quote].filter((q): q is string => !!q && quoteAppearsIn(q, text));
  const dateCheck = (value: string, quote: string) => checkDate(value, quote, yearContext);
  const startLocal = verify<string>("start", startRaw, dateCheck);
  const endLocal = verify<string>("end", endRaw, dateCheck);
  const deadlineLocal = verify<string>("applicationDeadline", readField(out.applicationDeadline), dateCheck);

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
  ].filter(Boolean);
  if (missing.length) return reject(`required fields missing or unverified: ${missing.join(", ")}`);

  // Local times → ISO with offset. Date-only start/end cover the whole day.
  const toIso = (local: string, fallbackTime: string) =>
    local.includes("T") ? localToIso(local.slice(0, 10), local.slice(11), timezone!) : localToIso(local, fallbackTime, timezone!);
  const start = toIso(startLocal!, "00:00");
  const end = toIso(endLocal!, "23:59:59");
  keepEvidence("start");
  keepEvidence("end");
  if (Date.parse(end) < Date.parse(start)) return reject(`end (${end}) is before start (${start})`);

  let applicationDeadline: string | null = null;
  let exactCutoffUnknown = false;
  if (deadlineLocal) {
    const iso = toIso(deadlineLocal, "23:59:59");
    if (Date.parse(iso) > Date.parse(end)) {
      const report = fields.find((f) => f.field === "applicationDeadline")!;
      Object.assign(report, { status: "discarded", reason: "deadline is after the event ends" });
    } else {
      applicationDeadline = iso;
      exactCutoffUnknown = !deadlineLocal.includes("T");
      keepEvidence("applicationDeadline");
    }
  }

  const opportunity: Opportunity = {
    id: listingId({ name: name!, start, timezone: timezone! }),
    name: name!,
    organizer: organizer ?? "Unknown",
    type: type!,
    description: description ?? "No description stated by the source.",
    officialUrl: officialUrl ?? sourceUrl,
    applyUrl,
    format: format!,
    location: locationValue,
    timezone: timezone!,
    start,
    end,
    applicationDeadline,
    exactCutoffUnknown,
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
    parseOpportunities([opportunity], "extraction", { real: true });
  } catch (err) {
    if (err instanceof InvalidOpportunityError) return reject(err.message);
    throw err;
  }
  return { opportunity, fields, rejectReason: null };
}
