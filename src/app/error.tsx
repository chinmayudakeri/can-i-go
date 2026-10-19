"use client";

import { StateMessage } from "@/components/StateMessage";

/** Catches unexpected render errors so a single bad event can't blank the app. */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <StateMessage kind="error" title="Something went wrong">
      <p>{error.message}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </StateMessage>
  );
}
