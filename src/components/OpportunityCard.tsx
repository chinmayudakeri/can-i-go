import Link from "next/link";
import type { FeedItem } from "@/lib/feed";
import { FORMAT_LABELS, TYPE_LABELS, formatEventDates, formatPlace } from "@/lib/format";
import { CostList } from "./CostList";
import { DatasetLabel } from "./DatasetLabel";
import { DeadlineText } from "./DeadlineText";
import { EligibilityBadge } from "./EligibilityBadge";
import { FeasibilitySummary } from "./FeasibilitySummary";
import { RelevanceReasons } from "./RelevanceReasons";
import { ShortlistButton } from "./ShortlistButton";
import type { OpportunityFeasibility } from "@/lib/feasibility/forOpportunity";

export function OpportunityCard({
  item,
  now,
  feasibility,
  saved,
  onToggleSave,
}: {
  item: FeedItem;
  now: Date;
  /** null while the browser's calendar data is loading. */
  feasibility: OpportunityFeasibility | null;
  saved: boolean;
  onToggleSave: () => string | null;
}) {
  const { opportunity: o, eligibility, deadline, costs, relevance } = item;
  const href = `/events/${encodeURIComponent(o.id)}`;
  const flagged = eligibility.checks.filter((c) => c.status === eligibility.status && c.status !== "matches");

  return (
    <article className={`card${deadline.kind === "passed" ? " card-passed" : ""}`}>
      <header className="card-header">
        <div className="chips">
          <DatasetLabel opportunity={o} />
          <span className="chip">{TYPE_LABELS[o.type]}</span>
          <span className="chip">{FORMAT_LABELS[o.format]}</span>
          {o.beginnerFriendly && <span className="chip chip-accent">Beginner friendly</span>}
        </div>
        <h2>
          <Link href={href}>{o.name}</Link>
        </h2>
        <p className="muted">{o.organizer}</p>
        <p className="when-where">
          {formatEventDates(o)} · {formatPlace(o)}
        </p>
      </header>

      <section className="card-row" aria-label="Eligibility">
        <EligibilityBadge status={eligibility.status} />
        {flagged.length > 0 && <span className="muted small">{flagged.map((c) => c.label).join(", ")}</span>}
      </section>

      <DeadlineText deadline={deadline} opportunity={o} now={now} />

      {/* Attendance comes before relevance so a conflict is never buried under reasons to go. */}
      <FeasibilitySummary feasibility={feasibility} detailHref={href} />

      <section aria-label="Costs">
        <CostList costs={costs} />
      </section>

      <RelevanceReasons relevance={relevance} />

      <footer className="card-footer">
        <ShortlistButton name={o.name} saved={saved} onToggle={onToggleSave} />
        <Link href={href} className="details-link">
          Details →
        </Link>
      </footer>
    </article>
  );
}
