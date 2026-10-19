"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { CostList } from "@/components/CostList";
import { DatasetLabel } from "@/components/DatasetLabel";
import { DeadlineText } from "@/components/DeadlineText";
import { EligibilityBadge } from "@/components/EligibilityBadge";
import { EvidenceNote } from "@/components/EvidenceNote";
import { RelevanceReasons } from "@/components/RelevanceReasons";
import { StateMessage } from "@/components/StateMessage";
import { useNow } from "@/hooks/useNow";
import { useOpportunities } from "@/hooks/useOpportunities";
import { useProfile } from "@/hooks/useProfile";
import { buildFeedItem } from "@/lib/feed";
import {
  FORMAT_LABELS,
  SUPPORT_LABELS,
  TYPE_LABELS,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import type { Opportunity, StudentProfile, SupportLevel } from "@/lib/types";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const opps = useOpportunities();
  const { state: profileState } = useProfile();

  if (opps.status === "loading" || profileState.status === "loading") {
    return <StateMessage kind="loading" title="Loading event…" />;
  }
  if (opps.status === "error") {
    return (
      <StateMessage kind="error" title="Couldn't load this event">
        <p>{opps.error}</p>
        <button type="button" onClick={opps.retry}>
          Try again
        </button>
      </StateMessage>
    );
  }

  const opportunity = opps.opportunities.find((o) => o.id === decodeURIComponent(id));
  if (!opportunity) {
    return (
      <StateMessage kind="empty" title="Event not found">
        <p>It may have been removed from its source.</p>
        <Link href="/">Back to Discover</Link>
      </StateMessage>
    );
  }

  return (
    <EventDetail
      opportunity={opportunity}
      profile={profileState.status === "ready" ? profileState.profile : null}
      profileError={profileState.status === "error" ? profileState.error : null}
    />
  );
}

function EventDetail({
  opportunity: o,
  profile,
  profileError,
}: {
  opportunity: Opportunity;
  profile: StudentProfile | null;
  profileError: string | null;
}) {
  const now = useNow();
  const item = useMemo(() => buildFeedItem(o, profile, now), [o, profile, now]);
  const { eligibility, deadline, costs, relevance } = item;
  const sources = [...new Set([o.sourceUrl, ...(o.sourceUrls ?? [])])];

  return (
    <article className="detail">
      <p>
        <Link href="/">← Back to Discover</Link>
      </p>

      <header className="detail-header">
        <div className="chips">
          <DatasetLabel opportunity={o} />
          <span className="chip">{TYPE_LABELS[o.type]}</span>
          <span className="chip">{FORMAT_LABELS[o.format]}</span>
          {o.beginnerFriendly === true && <span className="chip chip-accent">Beginner friendly</span>}
        </div>
        <h1>{o.name}</h1>
        <p className="muted">{o.organizer}</p>
        <p>{o.description}</p>
        <div className="link-row">
          <a href={o.officialUrl} target="_blank" rel="noreferrer">
            Official page
          </a>
          {o.applyUrl ? (
            <a href={o.applyUrl} target="_blank" rel="noreferrer" className="button">
              Apply
            </a>
          ) : (
            <span className="muted">No application link published</span>
          )}
        </div>
      </header>

      <section className="panel">
        <h2>When and where</h2>
        <dl className="facts">
          <dt>Starts</dt>
          <dd>{formatDateTime(o.start, o.timezone)}</dd>
          <dt>Ends</dt>
          <dd>{formatDateTime(o.end, o.timezone)}</dd>
          <dt>Location</dt>
          <dd>
            {o.location && o.format !== "online" ? (
              <>
                {[o.location.venue, o.location.city, o.location.region, o.location.country].filter(Boolean).join(", ")}
                {o.format === "hybrid" && " (or join online)"}
              </>
            ) : (
              "Online"
            )}
            {o.evidence.location && <EvidenceNote evidence={o.evidence.location} />}
          </dd>
          <dt>Team size</dt>
          <dd>
            {o.teamSize ? (o.teamSize.min === o.teamSize.max ? o.teamSize.min : `${o.teamSize.min}–${o.teamSize.max}`) : "Not stated"}
          </dd>
          <dt>Calendar</dt>
          <dd className="calendar-pending">Not checked yet</dd>
        </dl>
      </section>

      <section className="panel">
        <h2>Application deadline</h2>
        <DeadlineText deadline={deadline} opportunity={o} now={now} />
        {o.evidence.applicationDeadline && <EvidenceNote evidence={o.evidence.applicationDeadline} />}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Eligibility</h2>
          <EligibilityBadge status={eligibility.status} />
        </div>
        {profileError && <p className="notice notice-warn">Couldn&apos;t read your profile: {profileError}</p>}
        {!profile && !profileError && (
          <p className="notice">
            <Link href="/profile">Add your profile</Link> to check these against your details.
          </p>
        )}
        <table className="checks">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">What the source says</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {eligibility.checks.map((c, i) => (
              <tr key={`${c.field}-${i}`}>
                <th scope="row">{c.label}</th>
                <td>
                  {c.requirement}
                  {c.evidence ? (
                    <EvidenceNote evidence={c.evidence} />
                  ) : (
                    <span className="evidence">No direct quote recorded</span>
                  )}
                </td>
                <td>
                  <EligibilityBadge status={c.status} small />
                  <p className="small">{c.explanation}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Costs</h2>
        <CostList costs={costs} opportunity={o} showEvidence />
        <h3>Support from the organizer</h3>
        <dl className="facts">
          <Support label="Lodging" level={o.lodgingSupport} evidence={o.evidence.lodgingSupport} />
          <Support label="Food" level={o.foodSupport} evidence={o.evidence.foodSupport} />
          <Support label="Travel" level={o.travelSupport} evidence={o.evidence.travelSupport} />
        </dl>
      </section>

      <section className="panel">
        <h2>Fit</h2>
        <RelevanceReasons relevance={relevance} />
        {o.tags.length > 0 && (
          <p className="chips">
            {o.tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </p>
        )}
      </section>

      <footer className="source-footer">
        {o.dataset !== "real" && <p className="demo-note">DEMO: this event is fictional.</p>}
        {sources.length > 1 ? (
          <>
            <p>Sources:</p>
            <ul>
              {sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Source:{" "}
            <a href={o.sourceUrl} target="_blank" rel="noreferrer">
              {o.sourceUrl}
            </a>
          </p>
        )}
        <p>Last verified: {formatDate(`${o.lastVerified}T12:00:00Z`, "UTC")}</p>
      </footer>
    </article>
  );
}

function Support({
  label,
  level,
  evidence,
}: {
  label: string;
  level: SupportLevel | null;
  evidence: Opportunity["evidence"][keyof Opportunity["evidence"]];
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {level ? SUPPORT_LABELS[level] : <span className="unknown">Not stated</span>}
        {evidence && <EvidenceNote evidence={evidence} />}
      </dd>
    </>
  );
}
