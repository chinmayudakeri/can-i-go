"use client";

import { useState } from "react";

/** Toggle with aria-pressed; reports a storage failure instead of failing silently. */
export function ShortlistButton({ name, saved, onToggle }: { name: string; saved: boolean; onToggle: () => string | null }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="shortlist-toggle">
      <button
        type="button"
        className={saved ? "secondary" : undefined}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${name} from shortlist` : `Save ${name} to shortlist`}
        onClick={() => setError(onToggle())}
      >
        {saved ? "★ Shortlisted" : "☆ Shortlist"}
      </button>
      {error && (
        <span role="alert" className="error-text small">
          {error}
        </span>
      )}
    </span>
  );
}
