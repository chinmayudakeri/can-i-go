import Link from "next/link";
import { describeAssumptions } from "@/lib/feasibility/assumptions";
import type { OpportunityFeasibility } from "@/lib/feasibility/forOpportunity";
import type { CalendarCoverage } from "@/lib/calendar/types";
import { FeasibilityIcon } from "./FeasibilitySummary";

/** Detail view: every finding, what's missing, and the assumptions behind the answer. */
export function FeasibilityPanel({
  feasibility,
  coverage,
  calendarError,
}: {
  feasibility: OpportunityFeasibility | null;
  coverage: CalendarCoverage[];
  calendarError: string | null;
}) {
  return (
    <section className="panel" aria-labelledby="feasibility-heading">
      <h2 id="feasibility-heading">Can you attend?</h2>
      {calendarError && (
        <p className="notice notice-warn" role="alert">
          Couldn&apos;t read your saved calendar ({calendarError}), so attendance can&apos;t be checked.
        </p>
      )}
      {!feasibility ? (
        <p className="muted">Checking your calendar…</p>
      ) : (
        <Body feasibility={feasibility} coverage={coverage} />
      )}
    </section>
  );
}

function Body({ feasibility: { view, result, used }, coverage }: { feasibility: OpportunityFeasibility; coverage: CalendarCoverage[] }) {
  const strong = result.softWarnings.filter((w) => w.strong);
  const soft = result.softWarnings.filter((w) => !w.strong);
  return (
    <>
      <p className={`feas feas-${view.tone} feas-label`}>
        <FeasibilityIcon tone={view.tone} /> {view.label}
      </p>
      <p>{view.detail}</p>
      {view.notChecked && (
        <p className="notice">
          No calendar is connected. <Link href="/calendar">Import one</Link> so we can check your schedule; until then we can&apos;t say you&apos;re free.
        </p>
      )}

      <h3>Hard conflicts ({result.hardConflicts.length})</h3>
      {result.hardConflicts.length ? (
        <ul className="feas-list feas-bad-list">
          {result.hardConflicts.map((c, i) => (
            <li key={i}>{c.message}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">None found{view.notChecked ? " in what you've entered" : ""}.</p>
      )}

      <h3>Warnings ({result.softWarnings.length})</h3>
      {result.softWarnings.length ? (
        <ul className="feas-list">
          {strong.map((w, i) => (
            <li key={`s${i}`} className="feas-strong">
              <strong>Strong warning:</strong> {w.message}
            </li>
          ))}
          {soft.map((w, i) => (
            <li key={`w${i}`}>{w.message}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}

      <h3>Missing information ({result.missingInformation.length})</h3>
      {result.missingInformation.length ? (
        <ul className="feas-list">
          {result.missingInformation.map((m, i) => (
            <li key={i}>
              {m.message}
              {m.blocking && <span className="chip chip-warn">Needs confirmation</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing missing.</p>
      )}

      <h3>Assumptions used</h3>
      <ul className="assumptions">
        <li>{result.plan.basisLabel}</li>
        {describeAssumptions(used).map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          Calendars checked:{" "}
          {coverage.length
            ? coverage.map((c) => `${c.calendarName} (${c.from && c.until ? `${c.from} to ${c.until}` : "no dates"})`).join("; ")
            : "none"}
        </li>
      </ul>
      <p className="small">
        <Link href="/profile">Change your assumptions</Link> · <Link href="/calendar">Manage calendars</Link>
      </p>
    </>
  );
}
