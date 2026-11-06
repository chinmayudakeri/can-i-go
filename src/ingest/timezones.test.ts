import { describe, expect, it } from "vitest";
import { isValidTimeZone } from "@/lib/validate";
import { TABLE_ZONES, deriveTimeZone } from "./timezones";

const loc = (city: string | null, region: string | null = null, country: string | null = null, venue: string | null = null) => ({ venue, city, region, country });

describe("deriveTimeZone", () => {
  it.each([
    [loc("Waterloo", "ON"), "America/Toronto"],
    [loc("Toronto", "Ontario"), "America/Toronto"],
    [loc("Montréal", "QC"), "America/Toronto"],
    [loc("Québec", "QC"), "America/Toronto"],
    [loc("Vancouver", "BC"), "America/Vancouver"],
    [loc("Calgary", null, "Canada"), "America/Edmonton"],
    [loc("St. John's", "NL"), "America/St_Johns"],
    [loc("Saskatoon", "SK"), "America/Regina"],
    [loc("London", null, "Canada"), "America/Toronto"],
    [loc(null, "NS", null, "Dalhousie University"), "America/Halifax"],
    [loc("Wolfville", "Nova Scotia"), "America/Halifax"],
  ])("%j → %s", (location, zone) => {
    expect(deriveTimeZone(location)).toMatchObject({ timezone: zone, via: expect.stringContaining(zone) });
  });

  it.each([
    [loc("London"), /"London" alone is ambiguous/],
    [loc("Vancouver", "WA"), /"WA" is not a Canadian province/],
    [loc("Waterloo", "Iowa"), /not a Canadian province/],
    [loc("Toronto", null, "United States"), /only covers Canada/],
    [loc("Vancouver", "ON"), /Vancouver in the table is in BC, but the stated province is ON/],
    [loc("Kenora", "ON"), /Ontario spans more than one timezone, and "Kenora" is not in the city table/],
    [loc(null, "BC", null, "Some Hall"), /British Columbia spans more than one timezone, and no city is stated/],
    [loc("Springfield"), /not in the city table and no province is stated/],
    [loc(null, null, null, "Engineering Hall"), /no city or province is stated/],
  ])("refuses %j", (location, reason) => {
    const result = deriveTimeZone(location);
    expect(result.timezone).toBeNull();
    expect(result.timezone === null ? result.reason : "").toMatch(reason);
  });

  it("refuses when there's no location", () => {
    expect(deriveTimeZone(null)).toEqual({ timezone: null, reason: "no stated location to derive it from" });
  });

  it("only produces valid IANA zones", () => {
    expect(TABLE_ZONES.length).toBeGreaterThan(5);
    for (const zone of TABLE_ZONES) expect(isValidTimeZone(zone)).toBe(true);
  });
});
