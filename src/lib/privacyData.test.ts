import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_STORAGE_KEYS, deleteAllData, exportAllData } from "./privacyData";

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("privacy data", () => {
  it("lists every localStorage key the app defines", () => {
    const src = path.resolve(__dirname, "..");
    const defined = files(src).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/_STORAGE_KEY\s*=\s*"([^"]+)"/g)].map((m) => m[1]));
    expect(defined.length).toBeGreaterThanOrEqual(4);
    expect(new Set(defined)).toEqual(new Set(ALL_STORAGE_KEYS.map((k) => k.key)));
  });

  it("exports everything stored, and deletes everything", () => {
    const store = memoryStore();
    store.setItem("can-i-go.profile.v1", JSON.stringify({ university: "Waterloo" }));
    store.setItem("can-i-go.shortlist.v1", "not json");
    store.setItem("unrelated", "keep");
    const out = exportAllData(store, new Date("2026-11-09T12:00:00Z"));
    expect(out).toMatchObject({
      app: "Can I Go?",
      exportedAt: "2026-11-09T12:00:00.000Z",
      data: { "can-i-go.profile.v1": { university: "Waterloo" }, "can-i-go.shortlist.v1": "not json", "can-i-go.calendar.v1": null },
    });
    deleteAllData(store);
    expect([...store.data.keys()]).toEqual(["unrelated"]);
  });
});
