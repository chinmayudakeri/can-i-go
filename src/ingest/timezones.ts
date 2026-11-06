import type { EventLocation } from "@/lib/types";

/**
 * Timezone from a verified location, by explicit lookup only (never the AI,
 * never a guess). A small table of Canadian provinces and major cities:
 *
 * - A city in the table counts only when the location also states its
 *   province or says Canada, so "London" alone (or "Vancouver, WA") is not
 *   taken as the Canadian one.
 * - A province alone is enough only if the whole province is on one zone.
 *   ON, QC, BC, NL, NU and SK have places on other zones (e.g. Kenora,
 *   Creston, Lloydminster), so for them the city must be in the table.
 */

interface Province {
  code: string;
  names: string[];
  /** Null when the province spans more than one zone. */
  zone: string | null;
}

const PROVINCES: Province[] = [
  { code: "AB", names: ["Alberta"], zone: "America/Edmonton" },
  { code: "BC", names: ["British Columbia"], zone: null },
  { code: "MB", names: ["Manitoba"], zone: "America/Winnipeg" },
  { code: "NB", names: ["New Brunswick"], zone: "America/Moncton" },
  { code: "NL", names: ["Newfoundland and Labrador", "Newfoundland"], zone: null },
  { code: "NS", names: ["Nova Scotia"], zone: "America/Halifax" },
  { code: "NT", names: ["Northwest Territories"], zone: "America/Yellowknife" },
  { code: "NU", names: ["Nunavut"], zone: null },
  { code: "ON", names: ["Ontario"], zone: null },
  { code: "PE", names: ["Prince Edward Island", "PEI"], zone: "America/Halifax" },
  { code: "QC", names: ["Quebec"], zone: null },
  { code: "SK", names: ["Saskatchewan"], zone: null },
  { code: "YT", names: ["Yukon"], zone: "America/Whitehorse" },
];

const CITIES: Record<string, string[]> = {
  "ON America/Toronto": [
    "Toronto", "Waterloo", "Kitchener", "Cambridge", "Guelph", "Hamilton", "London", "Ottawa", "Kingston", "Windsor",
    "Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "Burlington", "Oshawa", "St. Catharines",
    "Niagara Falls", "Barrie", "Sudbury", "Greater Sudbury", "Peterborough", "Thunder Bay", "Sault Ste. Marie", "North Bay",
    "Scarborough", "North York", "Etobicoke",
  ],
  "QC America/Toronto": ["Montreal", "Quebec City", "Laval", "Gatineau", "Sherbrooke", "Trois-Rivieres", "Longueuil"],
  "BC America/Vancouver": ["Vancouver", "Victoria", "Burnaby", "Surrey", "Richmond", "Kelowna", "Kamloops", "Nanaimo", "Prince George", "Abbotsford", "Coquitlam"],
  "AB America/Edmonton": ["Calgary", "Edmonton", "Lethbridge", "Red Deer"],
  "SK America/Regina": ["Saskatoon", "Regina"],
  "MB America/Winnipeg": ["Winnipeg"],
  "NS America/Halifax": ["Halifax", "Dartmouth"],
  "NB America/Moncton": ["Fredericton", "Moncton", "Saint John"],
  "PE America/Halifax": ["Charlottetown"],
  "NL America/St_Johns": ["St. John's"],
  "NU America/Iqaluit": ["Iqaluit"],
  "YT America/Whitehorse": ["Whitehorse"],
  "NT America/Yellowknife": ["Yellowknife"],
};

/** "St. John's" → "st johns", "Montréal" → "montreal". */
const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const CITY_INDEX = new Map<string, { province: string; zone: string }>();
for (const [key, cities] of Object.entries(CITIES)) {
  const [province, zone] = key.split(" ");
  for (const city of cities) CITY_INDEX.set(norm(city), { province, zone });
}
CITY_INDEX.set("quebec", { province: "QC", zone: "America/Toronto" }); // "Québec, QC" is the city

function findProvince(region: string): Province | undefined {
  const r = norm(region);
  return PROVINCES.find((p) => norm(p.code) === r || p.names.some((n) => norm(n) === r));
}

export type TimeZoneDerivation = { timezone: string; via: string } | { timezone: null; reason: string };

/** All zones the table can produce (for tests). */
export const TABLE_ZONES = [...new Set([...PROVINCES.flatMap((p) => (p.zone ? [p.zone] : [])), ...[...CITY_INDEX.values()].map((c) => c.zone)])];

export function deriveTimeZone(location: EventLocation | null): TimeZoneDerivation {
  if (!location) return { timezone: null, reason: "no stated location to derive it from" };
  const { city, region, country } = location;
  if (country && norm(country) !== "canada") return { timezone: null, reason: `the table only covers Canada, and the stated country is ${country}` };

  const province = region ? findProvince(region) : undefined;
  if (region && !province) return { timezone: null, reason: `"${region}" is not a Canadian province or territory in the table` };

  const place = [city, region, country].filter(Boolean).join(", ");
  const entry = city ? CITY_INDEX.get(norm(city)) : undefined;
  if (entry) {
    if (province && province.code !== entry.province) {
      return { timezone: null, reason: `${city} in the table is in ${entry.province}, but the stated province is ${region}` };
    }
    if (!province && !country) {
      return { timezone: null, reason: `"${city}" alone is ambiguous; the province or country must be stated` };
    }
    return { timezone: entry.zone, via: `${place} → ${entry.zone} (city table)` };
  }

  if (province?.zone) return { timezone: province.zone, via: `${place} → ${province.zone} (${province.code} is on one zone)` };
  if (province) {
    return {
      timezone: null,
      reason: `${province.names[0]} spans more than one timezone, and ${city ? `"${city}" is not in the city table` : "no city is stated"}`,
    };
  }
  return { timezone: null, reason: city ? `"${city}" is not in the city table and no province is stated` : "no city or province is stated" };
}
