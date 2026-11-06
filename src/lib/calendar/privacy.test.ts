import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Calendar data must stay in the browser: the calendar and feasibility code
 * may not make network requests or run on the server. (The secrets boundary
 * test separately keeps src/ingest and Node built-ins out of src/lib.)
 */

const LIB = path.resolve(__dirname, "..");
const files = [
  ...["calendar", "feasibility"].flatMap((dir) =>
    readdirSync(path.join(LIB, dir))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(LIB, dir, f)),
  ),
  path.join(LIB, "zonedTime.ts"),
];

describe("calendar privacy boundary", () => {
  it("finds the calendar and feasibility files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each([
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["sendBeacon", /sendBeacon/],
    ["WebSocket", /WebSocket/],
    ["EventSource", /EventSource/],
    ["server actions", /["']use server["']/],
    ["Next server APIs", /from\s+["']next\/(?:server|headers)/],
    ["ingest imports", /from\s+["'](?:@\/ingest|(?:\.\.\/)+ingest)/],
  ])("no calendar or feasibility file uses %s", (_name, pattern) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => path.relative(LIB, f));
    expect(offenders).toEqual([]);
  });
});
