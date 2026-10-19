import Link from "next/link";
import type { FeedItem } from "@/lib/feed";
import { FORMAT_LABELS, TYPE_LABELS, formatEventDates, formatPlace } from "@/lib/format";
import { CostList } from "./CostList";
import { DeadlineText } from "./DeadlineText";
import { EligibilityBadge } from "./EligibilityBadge";
import { RelevanceReasons } from "./RelevanceReasons";

export function OpportunityCard({ item, now }: { item: FeedItem; now: Date }) {
  const { opportunity: o, eligibility, deadline, costs, relevance } = item;
  const flagged = eligibility.checks.filter((c) => c.status === eligibility.status && c.status !== "matches");

  return (
    <article className={`card${deadline.kind === "passed" ? " card-passed" : ""}`}>
      <header className="card-header">
        <div className="chips">
          <span className="chip">{TYPE_LABELS[o.type]}</span>
          <span className="chip">{FORMAT_LABELS[o.format]}</span>
          {o.beginnerFriendly && <span className="chip chip-accent">Beginner friendly</span>}
        </div>
        <h2>
          <Link href={`/events/${encodeURIComponent(o.id)}`}>{o.name}</Link>
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

      <section aria-label="Costs">
        <CostList costs={costs} />
      </section>

      <RelevanceReasons relevance={relevance} />

      <footer className="card-footer">
        <span className="calendar-pending">📅 Calendar not checked yet</span>
        <Link href={`/events/${encodeURIComponent(o.id)}`} className="details-link">
          Details →
        </Link>
      </footer>
    </article>
  );
}
