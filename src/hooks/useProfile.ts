"use client";

import { useCallback, useEffect, useState } from "react";
import { PROFILE_STORAGE_KEY, deleteProfile, loadProfile, saveProfile } from "@/lib/profileStorage";
import type { StudentProfile } from "@/lib/types";

export type ProfileState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; profile: StudentProfile | null };

/** Reads the profile from localStorage on the client and keeps tabs in sync. */
export function useProfile() {
  const [state, setState] = useState<ProfileState>({ status: "loading" });

  const refresh = useCallback(() => {
    let result;
    try {
      result = loadProfile(window.localStorage);
    } catch (e) {
      // Accessing window.localStorage itself can throw when storage is blocked.
      result = { ok: false as const, error: e instanceof Error ? e.message : "Storage unavailable" };
    }
    setState(result.ok ? { status: "ready", profile: result.profile } : { status: "error", error: result.error });
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => e.key === PROFILE_STORAGE_KEY && refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const save = useCallback((profile: StudentProfile) => {
    saveProfile(window.localStorage, profile);
    setState({ status: "ready", profile });
  }, []);

  const remove = useCallback(() => {
    deleteProfile(window.localStorage);
    setState({ status: "ready", profile: null });
  }, []);

  return { state, save, remove };
}
