import Link from "next/link";
import type { OpportunityFeasibility } from "@/lib/feasibility/forOpportunity";

/**
 * Card view: the headline, then every hard conflict and strong warning in
 * full. Conflicts are never folded behind relevance or a count.
 */
export function FeasibilitySummary({
  feasibility,
  detailHref,
  compact = false,
}: {
  feasibility: OpportunityFeasibility | null;
  detailHref: string;
  /** Comparison view: headline and counts, with the full text one click away. */
  compact?: boolean;
}) {
  if (!feasibility) return <p className="feas feas-muted small">Checking your calendar…</p>;
  const { view, result } = feasibility;
  const strong = result.softWarnings.filter((w) => w.strong);
  const otherSoft = result.softWarnings.length - strong.length;
  const missing = result.missingInformation.length;

  if (compact) {
    const hard = result.hardConflicts.length;
    const counts = [
      hard ? `${hard} hard conflict${hard === 1 ? "" : "s"}` : null,
      strong.length ? `${strong.length} strong warning${strong.length === 1 ? "" : "s"}` : null,
      otherSoft ? `${otherSoft} other warning${otherSoft === 1 ? "" : "s"}` : null,
      missing ? `${missing} to confirm` : null,
    ].filter(Boolean);
    return (
      <div className={`feas feas-${view.tone}`}>
        <p className="feas-label">
          <FeasibilityIcon tone={view.tone} /> {view.label}
        </p>
        {counts.length > 0 && <p className="small">{counts.join(" · ")}</p>}
        <p className="small">
          <Link href={detailHref}>Read each one</Link>
        </p>
      </div>
    );
  }

  return (
    <section className={`feas feas-${view.tone}`} aria-label="Can you attend?">
      <p className="feas-label">
        <FeasibilityIcon tone={view.tone} /> {view.label}
      </p>
      {result.hardConflicts.length > 0 && (
        <ul className="feas-list">
          {result.hardConflicts.map((c, i) => (
            <li key={i}>{c.message}</li>
          ))}
        </ul>
      )}
      {strong.length > 0 && (
        <ul className="feas-list feas-strong">
          {strong.map((w, i) => (
            <li key={i}>
              <strong>Strong warning:</strong> {w.message}
            </li>
          ))}
        </ul>
      )}
      {(otherSoft > 0 || missing > 0) && (
        <p className="small">
          {[otherSoft ? `${otherSoft} other warning${otherSoft === 1 ? "" : "s"}` : null, missing ? `${missing} thing${missing === 1 ? "" : "s"} to confirm` : null]
            .filter(Boolean)
            .join(" · ")}{" "}
          · <Link href={detailHref}>See details</Link>
        </p>
      )}
      {view.notChecked && (
        <p className="small">
          <Link href="/calendar">Import a calendar</Link> to check your schedule.
        </p>
      )}
    </section>
  );
}

export function FeasibilityIcon({ tone }: { tone: "bad" | "warn" | "ok" | "muted" }) {
  // Shapes differ as well as colors, so status doesn't rely on color alone.
  const symbol = { bad: "✕", warn: "!", ok: "✓", muted: "?" }[tone];
  return (
    <span className={`feas-icon feas-icon-${tone}`} aria-hidden>
      {symbol}
    </span>
  );
}
