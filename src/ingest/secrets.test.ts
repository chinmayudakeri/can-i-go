import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps the API key and Node-only ingestion code out of the browser bundle:
 * nothing the frontend can import may touch env vars, Gemini, or src/ingest.
 */

const ROOT = path.resolve(__dirname, "../..");
const FRONTEND_DIRS = ["src/app", "src/components", "src/hooks", "src/lib", "src/sources"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe("secrets boundary", () => {
  const frontend = FRONTEND_DIRS.flatMap((d) => files(path.join(ROOT, d))).filter((f) => !f.endsWith(".test.ts"));

  it("finds the frontend files", () => {
    expect(frontend.length).toBeGreaterThan(20);
  });

  it.each([
    ["GEMINI", /GEMINI/i],
    ["process.env", /process\.env/],
    ["NEXT_PUBLIC_ variables", /NEXT_PUBLIC_/],
    ["ingest imports", /from\s+["'](?:@\/ingest|(?:\.\.\/)+ingest)/],
    ["Node built-ins", /from\s+["']node:/],
  ])("no frontend file references %s", (_name, pattern) => {
    const offenders = frontend.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("gitignores every .env file except the empty template", () => {
    const gitignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
    expect(gitignore).toContain(".env*");
    expect(gitignore).toContain("!.env.example");
  });

  it(".env.example holds no values", () => {
    const assignments = readFileSync(path.join(ROOT, ".env.example"), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) expect(line).toMatch(/^[A-Z_]+=$/);
  });
});
