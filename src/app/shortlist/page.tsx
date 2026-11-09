"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CostList } from "@/components/CostList";
import { DatasetLabel } from "@/components/DatasetLabel";
import { DeadlineText } from "@/components/DeadlineText";
import { downloadFile } from "@/components/download";
import { EligibilityBadge } from "@/components/EligibilityBadge";
import { FeasibilitySummary } from "@/components/FeasibilitySummary";
import { StateMessage } from "@/components/StateMessage";
import { useNow } from "@/hooks/useNow";
import { useOpportunities } from "@/hooks/useOpportunities";
import { useProfile } from "@/hooks/useProfile";
import { useStudentContext } from "@/hooks/useStudentContext";
import { exportShortlistIcs } from "@/lib/calendar/exportIcs";
import { assumptionsFromProfile } from "@/lib/feasibility/assumptions";
import { feasibilityFor } from "@/lib/feasibility/forOpportunity";
import { findShortlistConflicts } from "@/lib/feasibility";
import { buildFeedItem } from "@/lib/feed";
import { formatEventDates, formatPlace } from "@/lib/format";
import { APPLICATION_STATUSES, MAX_NOTES_LENGTH, STATUS_LABELS, type ApplicationStatus, type SavedOpportunity } from "@/lib/shortlist";
import type { Opportunity, StudentProfile } from "@/lib/types";

export default function ShortlistPage() {
  const opps = useOpportunities();
  const { state: profileState } = useProfile();
  return (
    <>
      <div className="page-head">
        <h1>Shortlist</h1>
        <p className="muted">Events you saved, side by side. Saved only in this browser.</p>
      </div>
      {opps.status === "loading" || profileState.status === "loading" ? (
        <StateMessage kind="loading" title="Loading your shortlist…" />
      ) : opps.status === "error" ? (
        <StateMessage kind="error" title="Couldn't load events">
          <p>{opps.error}</p>
          <button type="button" onClick={opps.retry}>
            Try again
          </button>
        </StateMessage>
      ) : (
        <Shortlist opportunities={opps.opportunities} profile={profileState.status === "ready" ? profileState.profile : null} />
      )}
    </>
  );
}

function Shortlist({ opportunities, profile }: { opportunities: Opportunity[]; profile: StudentProfile | null }) {
  const now = useNow();
  const { state, shortlist } = useStudentContext(opportunities, profile);
  const [status, setStatus] = useState<string | null>(null);
  const byId = useMemo(() => new Map(opportunities.map((o) => [o.id, o])), [opportunities]);
  const saved = useMemo(() => shortlist.list.filter((s) => byId.has(s.opportunityId)), [shortlist.list, byId]);
  const gone = useMemo(() => shortlist.list.filter((s) => !byId.has(s.opportunityId)), [shortlist.list, byId]);

  const columns = useMemo(
    () =>
      state.status === "ready"
        ? saved.map((s) => {
            const o = byId.get(s.opportunityId)!;
            return { saved: s, item: buildFeedItem(o, profile, now), feasibility: feasibilityFor(o, state.ctx, now) };
          })
        : [],
    [state, saved, byId, profile, now],
  );
  const pairs = useMemo(
    () =>
      state.status === "ready"
        ? findShortlistConflicts(state.ctx.shortlistEntries, assumptionsFromProfile(profile, null, state.ctx.timezone).assumptions)
        : [],
    [state, profile],
  );

  if (state.status === "loading") return <StateMessage kind="loading" title="Loading your shortlist…" />;
  if (state.shortlistError) {
    return (
      <StateMessage kind="error" title="Couldn't read your shortlist">
        <p>{state.shortlistError}</p>
      </StateMessage>
    );
  }
  if (shortlist.list.length === 0) {
    return (
      <StateMessage kind="empty" title="Nothing shortlisted yet">
        <p>
          Use <strong>☆ Shortlist</strong> on any event in <Link href="/">Discover</Link> to save it here.
        </p>
      </StateMessage>
    );
  }

  const exportIcs = () => {
    downloadFile("can-i-go-shortlist.ics", exportShortlistIcs(saved.map((s) => byId.get(s.opportunityId)!), new Date()), "text/calendar");
    setStatus(`Downloaded ${saved.length} event${saved.length === 1 ? "" : "s"} as can-i-go-shortlist.ics.`);
  };

  return (
    <div className="stack">
      {!state.ctx.calendarsConnected && (
        <p className="notice">
          No calendar connected: attendance feasibility has not been checked. <Link href="/calendar">Import a calendar</Link>.
        </p>
      )}

      <section className="panel" aria-labelledby="clash-heading">
        <h2 id="clash-heading">Clashes between shortlisted events ({pairs.length})</h2>
        {pairs.length ? (
          <ul className="feas-list feas-bad-list">
            {pairs.map((p) => (
              <li key={`${p.a}-${p.b}`}>{p.message}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">None: no two shortlisted events overlap{saved.length < 2 ? " (save at least two to compare)" : ""}.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="compare-heading">
        <h2 id="compare-heading">Compare</h2>
        {/* Phones get one card per event; wider screens get the side-by-side table. Only one is displayed. */}
        <ul className="compare-cards">
          {columns.map(({ saved: s, item, feasibility }) => {
            const o = item.opportunity;
            const href = `/events/${encodeURIComponent(o.id)}`;
            return (
              <li key={o.id} className="compare-card">
                <h3>
                  <Link href={href}>{o.name}</Link>
                </h3>
                <DatasetLabel opportunity={o} />
                <dl className="facts">
                  <dt>When and where</dt>
                  <dd>
                    {formatEventDates(o)} · {formatPlace(o)}
                  </dd>
                  <dt>Can you attend?</dt>
                  <dd>
                    <FeasibilitySummary feasibility={feasibility} detailHref={href} compact />
                  </dd>
                  <dt>Deadline</dt>
                  <dd>
                    <DeadlineText deadline={item.deadline} opportunity={o} now={now} />
                  </dd>
                  <dt>Eligibility</dt>
                  <dd>
                    <EligibilityBadge status={item.eligibility.status} small />
                  </dd>
                  <dt>Cost</dt>
                  <dd>
                    <CostList costs={item.costs} />
                  </dd>
                  <dt>Your status</dt>
                  <dd>{STATUS_LABELS[s.status]}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="table-scroll" role="region" aria-labelledby="compare-heading" tabIndex={0}>
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Detail</span>
                </th>
                {columns.map(({ item }) => (
                  <th scope="col" key={item.opportunity.id}>
                    <Link href={`/events/${encodeURIComponent(item.opportunity.id)}`}>{item.opportunity.name}</Link>
                    <div>
                      <DatasetLabel opportunity={item.opportunity} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="When and where">
                {columns.map(({ item: { opportunity: o } }) => (
                  <td key={o.id}>
                    {formatEventDates(o)}
                    <br />
                    {formatPlace(o)}
                  </td>
                ))}
              </Row>
              <Row label="Can you attend?">
                {columns.map(({ item, feasibility }) => (
                  <td key={item.opportunity.id}>
                    <FeasibilitySummary feasibility={feasibility} detailHref={`/events/${encodeURIComponent(item.opportunity.id)}`} compact />
                  </td>
                ))}
              </Row>
              <Row label="Deadline">
                {columns.map(({ item }) => (
                  <td key={item.opportunity.id}>
                    <DeadlineText deadline={item.deadline} opportunity={item.opportunity} now={now} />
                  </td>
                ))}
              </Row>
              <Row label="Eligibility">
                {columns.map(({ item }) => (
                  <td key={item.opportunity.id}>
                    <EligibilityBadge status={item.eligibility.status} small />
                  </td>
                ))}
              </Row>
              <Row label="Cost">
                {columns.map(({ item }) => (
                  <td key={item.opportunity.id}>
                    <CostList costs={item.costs} />
                  </td>
                ))}
              </Row>
              <Row label="Your status">
                {columns.map(({ saved: s, item }) => (
                  <td key={item.opportunity.id}>{STATUS_LABELS[s.status]}</td>
                ))}
              </Row>
            </tbody>
          </table>
        </div>
        <p className="small muted">Costs are never added across currencies. Unknown costs stay Unknown.</p>
      </section>

      <section className="panel" aria-labelledby="manage-heading">
        <h2 id="manage-heading">Your applications</h2>
        <ul className="saved-list">
          {saved.map((s) => (
            <SavedItem key={s.opportunityId} saved={s} opportunity={byId.get(s.opportunityId)!} profile={profile} actions={shortlist} />
          ))}
        </ul>
        {gone.length > 0 && (
          <>
            <h3>No longer listed ({gone.length})</h3>
            <p className="muted small">These saved events aren&apos;t returned by any source now.</p>
            <ul className="saved-list">
              {gone.map((s) => (
                <li key={s.opportunityId} className="saved-item">
                  <span>{s.opportunityId}</span>
                  <button type="button" className="secondary small-button" onClick={() => shortlist.remove(s.opportunityId)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="export-heading">
        <h2 id="export-heading">Add to your calendar</h2>
        <p className="muted small">
          Downloads an .ics file made in this browser. Attendance is added as timed events (one per session when a schedule
          is published). Each application deadline is a separate entry: at its exact time, or all day when the time isn&apos;t
          published. Demo events are labelled [DEMO].
        </p>
        <button type="button" onClick={exportIcs} disabled={!saved.length}>
          Download .ics
        </button>
        <p role="status" className="form-status">
          {status}
        </p>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {children}
    </tr>
  );
}

function SavedItem({
  saved: s,
  opportunity: o,
  profile,
  actions,
}: {
  saved: SavedOpportunity;
  opportunity: Opportunity;
  profile: StudentProfile | null;
  actions: ReturnType<typeof useStudentContext>["shortlist"];
}) {
  const [notes, setNotes] = useState(s.notes);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setNotes(s.notes), [s.notes]);
  const id = `saved-${o.id}`;
  const profileMinutes = profile?.travelMinutes;

  return (
    <li className="saved-item">
      <h3 id={id}>
        <Link href={`/events/${encodeURIComponent(o.id)}`}>{o.name}</Link>
      </h3>
      <div className="saved-fields">
        <label className="field">
          <span>Application status</span>
          <select value={s.status} onChange={(e) => setError(actions.update(o.id, { status: e.target.value as ApplicationStatus }))}>
            {APPLICATION_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
        {o.format !== "online" && (
          <label className="field">
            <span>Travel time for this event (minutes, one way)</span>
            <input
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={s.travelMinutesOverride ?? ""}
              placeholder={profileMinutes != null ? `Profile default: ${profileMinutes}` : "Not entered"}
              onChange={(e) => {
                const v = e.target.value.trim();
                setError(actions.update(o.id, { travelMinutesOverride: v === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)) }));
              }}
            />
          </label>
        )}
        <label className="field notes-field">
          <span>Notes (only you see these)</span>
          <textarea
            value={notes}
            maxLength={MAX_NOTES_LENGTH}
            rows={3}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== s.notes && setError(actions.update(o.id, { notes }))}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="danger" aria-describedby={id} onClick={() => setError(actions.remove(o.id))}>
          Remove from shortlist
        </button>
        {error && (
          <span role="alert" className="error-text">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}
