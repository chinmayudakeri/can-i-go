"use client";

import Link from "next/link";
import { useState } from "react";
import { useCalendarEnabled } from "@/hooks/useCalendarEnabled";

/**
 * The "Use my calendar" switch (role="switch", so screen readers announce
 * on/off). When it's off, a link next to it still reaches the Calendar page.
 */
export function CalendarToggle() {
  const { ready, enabled, setEnabled } = useCalendarEnabled();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="calendar-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="switch"
        disabled={!ready}
        onClick={() => setError(setEnabled(!enabled))}
      >
        <span className="switch-track" aria-hidden>
          <span className="switch-thumb" />
        </span>
        <span>Use my calendar</span>
        <span className="switch-state" aria-hidden>
          {enabled ? "On" : "Off"}
        </span>
      </button>
      {ready && !enabled && (
        <Link href="/calendar" className="toggle-help">
          What&apos;s this?
        </Link>
      )}
      {error && (
        <span role="alert" className="error-text small">
          {error}
        </span>
      )}
    </div>
  );
}
