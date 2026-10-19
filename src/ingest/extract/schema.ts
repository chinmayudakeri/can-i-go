import { TOPICS } from "@/lib/format";
import { PROGRAMS } from "@/lib/types";

/**
 * The JSON shape we ask the model for, as a Gemini responseSchema (OpenAPI
 * subset). Every field is { value, quote, basis } so each value arrives with
 * the passage that supports it. Requirement lists use { openToAll, list }.
 */

type Schema = Record<string, unknown>;

export const OPPORTUNITY_TYPES = ["hackathon", "conference", "workshop", "competition", "career-fair", "meetup"] as const;
export const EVENT_FORMATS = ["in-person", "online", "hybrid"] as const;
export const SUPPORT_LEVELS = ["full", "partial", "none"] as const;
export const STUDY_YEARS = ["1", "2", "3", "4", "5+", "graduate"] as const;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;

const STRING: Schema = { type: "STRING" };
const nullable = (s: Schema): Schema => ({ ...s, nullable: true });
const enumOf = (values: readonly string[]): Schema => ({ type: "STRING", enum: [...values] });

const field = (value: Schema): Schema => ({
  type: "OBJECT",
  nullable: true,
  properties: {
    value: nullable(value),
    quote: nullable(STRING),
    basis: nullable(enumOf(["stated", "inferred"])),
  },
  required: ["value", "quote", "basis"],
});

const DATE: Schema = { type: "STRING", description: 'Local time in the event timezone: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"' };
const MONEY: Schema = {
  type: "OBJECT",
  properties: { amount: { type: "NUMBER" }, currency: { type: "STRING", description: "ISO 4217 code, e.g. CAD" } },
  required: ["amount", "currency"],
};
const requirement = (items: Schema): Schema => ({
  type: "OBJECT",
  properties: { openToAll: { type: "BOOLEAN" }, list: { type: "ARRAY", items } },
  required: ["openToAll", "list"],
});

export const EXTRACTION_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    isEvent: { type: "BOOLEAN", description: "false unless the page is about one specific event" },
    name: field(STRING),
    organizer: field(STRING),
    description: field(STRING),
    type: field(enumOf(OPPORTUNITY_TYPES)),
    format: field(enumOf(EVENT_FORMATS)),
    location: field({
      type: "OBJECT",
      properties: { venue: nullable(STRING), city: STRING, region: nullable(STRING), country: nullable(STRING) },
      required: ["city"],
    }),
    timezone: field({ type: "STRING", description: 'IANA name, e.g. "America/Toronto"' }),
    start: field(DATE),
    end: field(DATE),
    applicationDeadline: field(DATE),
    officialUrl: field(STRING),
    applyUrl: field(STRING),
    eligibility: {
      type: "OBJECT",
      properties: {
        studentStatusRequired: field({ type: "BOOLEAN" }),
        universities: field(requirement(STRING)),
        programs: field(requirement(enumOf(PROGRAMS))),
        years: field(requirement(enumOf(STUDY_YEARS))),
        experienceLevels: field(requirement(enumOf(EXPERIENCE_LEVELS))),
        otherRequirements: field({ type: "ARRAY", items: STRING }),
      },
      required: ["studentStatusRequired", "universities", "programs", "years", "experienceLevels", "otherRequirements"],
    },
    teamSize: field({ type: "OBJECT", properties: { min: { type: "INTEGER" }, max: { type: "INTEGER" } }, required: ["min", "max"] }),
    registrationFee: field(MONEY),
    travelCostEstimate: field(MONEY),
    lodgingSupport: field(enumOf(SUPPORT_LEVELS)),
    foodSupport: field(enumOf(SUPPORT_LEVELS)),
    travelSupport: field(enumOf(SUPPORT_LEVELS)),
    tags: field({ type: "ARRAY", items: enumOf(TOPICS) }),
    beginnerFriendly: field({ type: "BOOLEAN" }),
  },
  required: [
    "isEvent", "name", "organizer", "description", "type", "format", "location", "timezone", "start", "end",
    "applicationDeadline", "officialUrl", "applyUrl", "eligibility", "teamSize", "registrationFee", "travelCostEstimate",
    "lodgingSupport", "foodSupport", "travelSupport", "tags", "beginnerFriendly",
  ],
};
