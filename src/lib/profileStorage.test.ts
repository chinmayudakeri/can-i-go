import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, PROFILE_STORAGE_KEY, deleteProfile, loadProfile, sanitizeProfile, saveProfile, type KeyValueStore } from "./profileStorage";
import { makeProfile } from "./testFixtures";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("profile storage", () => {
  it("returns null when nothing is saved", () => {
    expect(loadProfile(memoryStore())).toEqual({ ok: true, profile: null });
  });

  it("round-trips a profile", () => {
    const store = memoryStore();
    saveProfile(store, makeProfile());
    expect(loadProfile(store)).toEqual({ ok: true, profile: makeProfile() });
  });

  it("deletes the saved profile", () => {
    const store = memoryStore();
    saveProfile(store, makeProfile());
    deleteProfile(store);
    expect(store.data.has(PROFILE_STORAGE_KEY)).toBe(false);
    expect(loadProfile(store)).toEqual({ ok: true, profile: null });
  });

  it("reports corrupt JSON as an error instead of throwing", () => {
    const store = memoryStore();
    store.setItem(PROFILE_STORAGE_KEY, "{not json");
    expect(loadProfile(store).ok).toBe(false);
  });

  it("reports storage that throws (e.g. blocked) as an error", () => {
    const store: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadProfile(store)).toEqual({ ok: false, error: "blocked" });
  });

  it("defaults to CAD and a Waterloo, ON starting location", () => {
    expect(EMPTY_PROFILE.budgetCurrency).toBe("CAD");
    expect(EMPTY_PROFILE.startingLocation).toBe("Waterloo, ON");
    expect(sanitizeProfile({})).toMatchObject({ budgetCurrency: "CAD", startingLocation: "Waterloo, ON", program: null });
  });

  it("keeps a starting location the user deliberately cleared", () => {
    expect(sanitizeProfile({ startingLocation: "" }).startingLocation).toBe("");
  });

  it("keeps dropdown programs and drops old free-text ones", () => {
    expect(sanitizeProfile({ program: "Computer Science" }).program).toBe("Computer Science");
    expect(sanitizeProfile({ program: "Other" }).program).toBe("Other");
    expect(sanitizeProfile({ program: "Honours CS" }).program).toBeNull();
  });

  it("drops malformed fields rather than trusting them", () => {
    const p = sanitizeProfile({ year: "7", budget: -5, interests: ["AI", 3], formatPreference: "teleport" });
    expect(p.year).toBeNull();
    expect(p.budget).toBeNull();
    expect(p.interests).toEqual(["AI"]);
    expect(p.formatPreference).toBe("either");
  });
});
