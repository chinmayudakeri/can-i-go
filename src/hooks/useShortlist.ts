"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addToShortlist,
  loadShortlist,
  removeFromShortlist,
  saveShortlist,
  SHORTLIST_STORAGE_KEY,
  updateSaved,
  type SavedOpportunity,
} from "@/lib/shortlist";

export type ShortlistState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; list: SavedOpportunity[] };

/** The shortlist in this browser's localStorage, kept in sync across tabs. */
export function useShortlist() {
  const [state, setState] = useState<ShortlistState>({ status: "loading" });

  const refresh = useCallback(() => {
    try {
      const r = loadShortlist(window.localStorage);
      setState(r.ok ? { status: "ready", list: r.value } : { status: "error", error: r.error });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Storage unavailable" });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => (e.key === null || e.key === SHORTLIST_STORAGE_KEY) && refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const list = state.status === "ready" ? state.list : [];
  // Latest saved list, so quick successive changes don't build on a stale render.
  const latest = useRef<SavedOpportunity[]>([]);
  if (state.status === "ready") latest.current = state.list;

  const write = useCallback((change: (current: SavedOpportunity[]) => SavedOpportunity[]): string | null => {
    const next = change(latest.current);
    try {
      saveShortlist(window.localStorage, next);
    } catch (e) {
      return `Couldn't save to this browser: ${e instanceof Error ? e.message : "storage error"}`;
    }
    latest.current = next;
    setState({ status: "ready", list: next });
    return null;
  }, []);

  return {
    state,
    list,
    isSaved: useCallback((id: string) => list.some((s) => s.opportunityId === id), [list]),
    add: useCallback((id: string) => write((l) => addToShortlist(l, id, new Date())), [write]),
    remove: useCallback((id: string) => write((l) => removeFromShortlist(l, id)), [write]),
    update: useCallback((id: string, patch: Parameters<typeof updateSaved>[2]) => write((l) => updateSaved(l, id, patch)), [write]),
    refresh,
  };
}
