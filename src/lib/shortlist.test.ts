import { describe, expect, it } from "vitest";
import { addToShortlist, loadShortlist, MAX_NOTES_LENGTH, removeFromShortlist, saveShortlist, SHORTLIST_STORAGE_KEY, updateSaved } from "./shortlist";

const NOW = new Date("2026-11-09T12:00:00Z");

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("shortlist", () => {
  it("adds once, updates and removes", () => {
    let list = addToShortlist([], "a", NOW);
    list = addToShortlist(list, "a", NOW);
    expect(list).toEqual([{ opportunityId: "a", addedAt: NOW.toISOString(), status: "considering", notes: "", travelMinutesOverride: null }]);
    list = updateSaved(list, "a", { status: "applied", notes: "Ask Priya about a team", travelMinutesOverride: 75 });
    expect(list[0]).toMatchObject({ status: "applied", notes: "Ask Priya about a team", travelMinutesOverride: 75 });
    expect(removeFromShortlist(list, "a")).toEqual([]);
  });

  it("rejects bad updates instead of storing them", () => {
    const list = addToShortlist([], "a", NOW);
    expect(updateSaved(list, "a", { status: "maybe" as never, travelMinutesOverride: -5 })[0]).toMatchObject({ status: "considering", travelMinutesOverride: null });
    expect(updateSaved(list, "a", { notes: "x".repeat(MAX_NOTES_LENGTH + 10) })[0].notes).toHaveLength(MAX_NOTES_LENGTH);
  });

  it("round-trips through storage, dropping malformed and duplicate entries", () => {
    const store = memoryStore();
    saveShortlist(store, addToShortlist([], "a", NOW));
    expect(loadShortlist(store)).toMatchObject({ ok: true, dropped: 0, value: [{ opportunityId: "a" }] });
    store.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify([{ opportunityId: "a" }, { opportunityId: "a" }, { nope: 1 }]));
    expect(loadShortlist(store)).toMatchObject({ ok: true, dropped: 2 });
    store.setItem(SHORTLIST_STORAGE_KEY, "{");
    expect(loadShortlist(store).ok).toBe(false);
  });
});
