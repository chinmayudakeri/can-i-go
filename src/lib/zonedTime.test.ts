import { describe, expect, it } from "vitest";
import { datesBetween, localDateOfMs, wallTimeToUtcMs } from "./zonedTime";

const wall = (s: string) => {
  const [d, t] = s.split("T");
  const [year, month, day] = d.split("-").map(Number);
  const [hour, minute] = t.split(":").map(Number);
  return { year, month, day, hour, minute, second: 0 };
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("wallTimeToUtcMs", () => {
  it("uses the offset for that date on both sides of a DST change", () => {
    expect(iso(wallTimeToUtcMs(wall("2026-10-31T10:00"), "America/Toronto"))).toBe("2026-10-31T14:00:00.000Z");
    expect(iso(wallTimeToUtcMs(wall("2026-11-01T10:00"), "America/Toronto"))).toBe("2026-11-01T15:00:00.000Z");
  });

  it("takes the earlier instant for a repeated hour and shifts a skipped hour forward", () => {
    expect(iso(wallTimeToUtcMs(wall("2026-11-01T01:30"), "America/Toronto"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(wallTimeToUtcMs(wall("2026-03-08T02:30"), "America/Toronto"))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("works east of UTC", () => {
    expect(iso(wallTimeToUtcMs(wall("2026-07-01T09:00"), "Asia/Kolkata"))).toBe("2026-07-01T03:30:00.000Z");
  });
});

describe("date helpers", () => {
  it("lists dates inclusively and reads local dates", () => {
    expect(datesBetween("2026-10-31", "2026-11-02")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(localDateOfMs(Date.parse("2026-11-15T03:00:00Z"), "America/Toronto")).toBe("2026-11-14");
  });
});
