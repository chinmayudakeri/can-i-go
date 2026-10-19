"use client";

import { useCallback, useEffect, useState } from "react";
import type { Opportunity } from "@/lib/types";
import { opportunitySource } from "@/sources";

export type OpportunitiesState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; opportunities: Opportunity[] };

// Shared across pages so going feed → detail → feed doesn't refetch.
let cached: Promise<Opportunity[]> | null = null;

function load(): Promise<Opportunity[]> {
  cached ??= opportunitySource.getOpportunities().catch((e) => {
    cached = null; // allow retry
    throw e;
  });
  return cached;
}

export function useOpportunities(): OpportunitiesState & { retry: () => void } {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load().then(
      (opportunities) => !cancelled && setState({ status: "ready", opportunities }),
      (e: unknown) =>
        !cancelled && setState({ status: "error", error: e instanceof Error ? e.message : "Unknown error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
