import { PROGRAMS, type Opportunity } from "./types";

/**
 * Light runtime check for data coming from a source. It catches the mistakes
 * that would otherwise crash the UI (missing fields, bad dates, wrong enums)
 * without duplicating every type. Sources should call this before returning.
 */
export class InvalidOpportunityError extends Error {}

const TYPES = ["hackathon", "conference", "workshop", "competition", "career-fair", "meetup"];
const FORMATS = ["in-person", "online", "hybrid"];

export function parseOpportunities(raw: unknown, sourceName: string): Opportunity[] {
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

    if (!o || typeof o !== "object") fail("not an object");
    for (const key of ["id", "name", "organizer", "description", "officialUrl", "timezone", "sourceUrl", "lastVerified"]) {
      if (typeof o[key] !== "string" || !(o[key] as string).trim()) fail(`missing "${key}"`);
    }
    if (seen.has(o.id as string)) fail("duplicate id");
    seen.add(o.id as string);

    if (!TYPES.includes(o.type as string)) fail(`unknown type "${String(o.type)}"`);
    if (!FORMATS.includes(o.format as string)) fail(`unknown format "${String(o.format)}"`);
    if (o.format !== "online" && !o.location) fail("in-person/hybrid events need a location");

    for (const key of ["start", "end"]) {
      if (typeof o[key] !== "string" || Number.isNaN(Date.parse(o[key] as string))) fail(`invalid "${key}" date`);
    }
    if (Date.parse(o.end as string) < Date.parse(o.start as string)) fail("ends before it starts");
    if (o.applicationDeadline !== null && Number.isNaN(Date.parse(o.applicationDeadline as string))) {
      fail('invalid "applicationDeadline"');
    }
    if (!o.eligibility || typeof o.eligibility !== "object") fail('missing "eligibility"');
    const programs = (o.eligibility as Record<string, unknown>).programs;
    if (Array.isArray(programs)) {
      const unknown = programs.filter((p) => !(PROGRAMS as readonly unknown[]).includes(p));
      if (unknown.length) fail(`unknown program(s) ${unknown.map((p) => JSON.stringify(p)).join(", ")}; use values from PROGRAMS`);
    }
    if (!Array.isArray(o.tags)) fail('"tags" must be an array');
    if (!o.evidence || typeof o.evidence !== "object") fail('missing "evidence"');

    return o as unknown as Opportunity;
  });
}
