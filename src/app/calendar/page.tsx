"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { StateMessage } from "@/components/StateMessage";
import { useCalendarData } from "@/hooks/useCalendarData";
import { parseManualCommitment } from "@/lib/calendar/commitments";
import { MAX_ICS_BYTES, parseIcs, tooLargeResult } from "@/lib/calendar/parseIcs";
import { MANUAL_COMMITMENT_KINDS, type Commitment, type ImportedCalendar, type ImportReport, type ManualCommitmentKind } from "@/lib/calendar/types";
import { browserTimezone } from "@/lib/feasibility/assumptions";
import { NOT_CHECKED_LABEL } from "@/lib/feasibility/view";
import { formatMoment, formatRange } from "@/lib/feasibility/format";
import { wallTimeToUtcMs } from "@/lib/zonedTime";

const KIND_LABELS: Record<Commitment["kind"], string> = {
  calendar: "Calendar event",
  class: "Class",
  exam: "Exam",
  assignment: "Assignment (due time)",
  work: "Work",
  personal: "Personal",
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Reads an .ics file in this browser. Size is checked before reading; nothing is uploaded. */
async function readCalendarFile(file: File, opts: { calendarId: string; calendarName: string; note: string | null; timezone: string }) {
  if (file.size > MAX_ICS_BYTES) return tooLargeResult(file.size, opts.calendarName);
  return parseIcs(await file.text(), { ...opts, now: new Date() });
}

type Outcome = { name: string; report: ImportReport; added: number | null; duplicatesSkipped: number; saveError: string | null };

export default function CalendarPage() {
  const data = useCalendarData();
  const [timezone, setTimezone] = useState("America/Toronto");
  useEffect(() => setTimezone(browserTimezone()), []);

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <p className="muted">
          Import your calendars and add commitments so we can check whether you can attend events. Files are read in
          this browser and saved only here (localStorage). Nothing is uploaded.
        </p>
      </div>
      {data.state.status === "loading" ? (
        <StateMessage kind="loading" title="Loading your calendars…" />
      ) : data.state.status === "error" ? (
        <StateMessage kind="error" title="Couldn't read your saved calendar data">
          <p>{data.state.error}</p>
          <p>Your browser may be blocking storage for this site, or the saved data is damaged.</p>
          <button type="button" className="danger" onClick={() => window.confirm("Delete all saved calendar data from this browser?") && data.deleteAll()}>
            Delete saved calendar data
          </button>
        </StateMessage>
      ) : (
        <CalendarManager
          calendars={data.state.store.calendars}
          commitments={data.state.commitments}
          dropped={data.state.dropped}
          timezone={timezone}
          actions={data}
        />
      )}
    </>
  );
}

function CalendarManager({
  calendars,
  commitments,
  dropped,
  timezone,
  actions,
}: {
  calendars: ImportedCalendar[];
  commitments: Commitment[];
  dropped: number;
  timezone: string;
  actions: ReturnType<typeof useCalendarData>;
}) {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const record = async (file: File, calendarId: string, calendarName: string, note: string | null) => {
    const result = await readCalendarFile(file, { calendarId, calendarName, note, timezone });
    if (!result.ok) return { name: calendarName, report: result.report, added: null, duplicatesSkipped: 0, saveError: null };
    const saved = actions.importCalendar(result.calendar, result.events);
    return { name: calendarName, report: result.report, added: saved.added, duplicatesSkipped: saved.duplicatesSkipped, saveError: saved.error };
  };

  const reimport = async (calendar: ImportedCalendar, file: File) => {
    setOutcomes([await record(file, calendar.id, calendar.name, calendar.coverage.note)]);
  };

  const deleteAll = () => {
    if (!window.confirm("Delete every imported calendar and every commitment you entered? This can't be undone.")) return;
    const error = actions.deleteAll();
    setOutcomes([]);
    setStatus(error ?? "All calendar data deleted from this browser.");
  };

  return (
    <div className="stack">
      {dropped > 0 && (
        <p className="notice notice-warn" role="alert">
          {dropped} saved item{dropped === 1 ? " was" : "s were"} damaged and couldn&apos;t be loaded. Re-import the affected calendar to restore it.
        </p>
      )}
      {calendars.length === 0 && (
        <p className="notice notice-strong" role="status">
          No calendar connected: {NOT_CHECKED_LABEL.toLowerCase()}. Import a calendar below to start.
        </p>
      )}

      <ImportForm
        onImport={async (files) => {
          const results: Outcome[] = [];
          // One at a time, so each import sees the previous one and duplicates are counted correctly.
          for (const f of files) results.push(await record(f.file, newId(), f.name, f.note));
          setOutcomes(results);
        }}
      />

      {outcomes.length > 0 && (
        <section className="panel" aria-labelledby="import-results" aria-live="polite">
          <h2 id="import-results">Import results</h2>
          {outcomes.map((o, i) => (
            <div key={i} className="import-outcome">
              <h3>{o.name}</h3>
              {o.saveError ? (
                <p className="error-text" role="alert">
                  {o.saveError}
                </p>
              ) : o.added === null ? (
                <p className="error-text">Not imported.</p>
              ) : (
                <p>
                  Imported {o.added} event{o.added === 1 ? "" : "s"}
                  {o.duplicatesSkipped ? `; ${o.duplicatesSkipped} already imported from another calendar were skipped` : ""}.
                </p>
              )}
              <ImportReportView report={o.report} />
            </div>
          ))}
        </section>
      )}

      <section className="panel" aria-labelledby="connected-heading">
        <h2 id="connected-heading">Connected calendars ({calendars.length})</h2>
        {calendars.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="calendar-list">
            {calendars.map((c) => (
              <CalendarItem
                key={c.id}
                calendar={c}
                onReimport={(file) => reimport(c, file)}
                onDisconnect={() => {
                  if (!window.confirm(`Disconnect "${c.name}"? Its events will be removed from this browser.`)) return;
                  setStatus(actions.disconnect(c.id) ?? `Disconnected "${c.name}".`);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <CommitmentsSection commitments={commitments} timezone={timezone} onAdd={actions.addCommitment} onRemove={actions.removeCommitment} />

      <section className="panel" aria-labelledby="danger-heading">
        <h2 id="danger-heading">Delete calendar data</h2>
        <p className="muted">Removes every imported calendar and every commitment you entered from this browser.</p>
        <button type="button" className="danger" onClick={deleteAll} disabled={calendars.length === 0 && commitments.length === 0}>
          Delete all calendar data
        </button>
      </section>
      <p role="status" className="form-status">
        {status}
      </p>
    </div>
  );
}

type PendingFile = { file: File; name: string; note: string | null };

function ImportForm({ onImport }: { onImport: (files: PendingFile[]) => Promise<void> }) {
  const [pending, setPending] = useState<{ file: File; name: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileHelp = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pending.length) return;
    setBusy(true);
    try {
      await onImport(pending.map((p) => ({ file: p.file, name: p.name.trim() || p.file.name, note: p.note.trim() || null })));
      setPending([]);
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit} aria-labelledby="import-heading">
      <h2 id="import-heading">Import calendars</h2>
      <label className="field">
        <span>.ics files (you can choose several)</span>
        <input
          ref={inputRef}
          type="file"
          accept=".ics,text/calendar"
          multiple
          aria-describedby={fileHelp}
          onChange={(e) =>
            setPending([...(e.target.files ?? [])].map((file) => ({ file, name: file.name.replace(/\.ics$/i, ""), note: "" })))
          }
        />
        <small id={fileHelp} className="muted">
          In Google Calendar: Settings → Import &amp; export → Export. In Outlook: save a calendar as .ics. Up to{" "}
          {MAX_ICS_BYTES / 1024 / 1024} MB each.
        </small>
      </label>
      {pending.map((p, i) => (
        <fieldset key={i} className="pending-file">
          <legend>{p.file.name}</legend>
          <label className="field">
            <span>Calendar name</span>
            <input
              value={p.name}
              required
              onChange={(e) => setPending((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
          </label>
          <label className="field">
            <span>What does it cover? (optional)</span>
            <input
              value={p.note}
              placeholder="e.g. Fall term classes only"
              onChange={(e) => setPending((list) => list.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
            />
          </label>
        </fieldset>
      ))}
      <div className="form-actions">
        <button type="submit" disabled={!pending.length || busy}>
          {busy ? "Importing…" : pending.length > 1 ? `Import ${pending.length} calendars` : "Import calendar"}
        </button>
      </div>
    </form>
  );
}

function CalendarItem({ calendar: c, onReimport, onDisconnect }: { calendar: ImportedCalendar; onReimport: (f: File) => void; onDisconnect: () => void }) {
  const inputId = useId();
  const { from, until, note } = c.coverage;
  const counts = c.report.counts;
  return (
    <li className="calendar-item">
      <h3>{c.name}</h3>
      <p>
        <strong>Covers:</strong> {from && until ? `${from} to ${until}` : "no dates (no events found)"}
        {note && <span className="muted"> · {note}</span>}
      </p>
      <p className="small muted">
        {counts.occurrences} events · imported {new Date(c.importedAt).toLocaleString()}
        {c.report.errors.length ? ` · ${counts.unreadable} couldn't be read` : ""}
      </p>
      <details>
        <summary>Import report</summary>
        <ImportReportView report={c.report} />
      </details>
      <div className="form-actions">
        <label htmlFor={inputId} className="button secondary file-button">
          Reimport…
        </label>
        <input
          id={inputId}
          type="file"
          accept=".ics,text/calendar"
          className="visually-hidden-input"
          aria-label={`Reimport ${c.name} from a new .ics file`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onReimport(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="danger" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </li>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  const c = report.counts;
  return (
    <div className="import-report">
      <dl className="facts">
        <dt>Events in file</dt>
        <dd>{c.components}</dd>
        <dt>Occurrences kept</dt>
        <dd>{c.occurrences}</dd>
        <dt>Cancelled (skipped)</dt>
        <dd>{c.cancelled}</dd>
        <dt>Shown as free (don&apos;t block time)</dt>
        <dd>{c.transparent}</dd>
        <dt>Duplicates in file</dt>
        <dd>{c.duplicates}</dd>
        <dt>Couldn&apos;t be read</dt>
        <dd>{c.unreadable}</dd>
      </dl>
      {report.errors.length > 0 && (
        <>
          <h4 className="error-text">Problems ({report.errors.length})</h4>
          <ul className="feas-list">
            {report.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </>
      )}
      {report.warnings.length > 0 && (
        <>
          <h4>Notes ({report.warnings.length})</h4>
          <ul className="feas-list">
            {report.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** "2026-11-14T09:30" from a datetime-local input, read in the student's timezone. */
function localInputToIso(value: string, timezone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  return new Date(wallTimeToUtcMs({ year, month, day, hour, minute, second: 0 }, timezone)).toISOString().replace(".000Z", "Z");
}

function CommitmentsSection({
  commitments,
  timezone,
  onAdd,
  onRemove,
}: {
  commitments: Commitment[];
  timezone: string;
  onAdd: (c: Commitment) => string | null;
  onRemove: (id: string) => string | null;
}) {
  const [kind, setKind] = useState<ManualCommitmentKind>("class");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const sorted = [...commitments].sort((a, b) => (a.kind === "assignment" ? a.due : a.start).localeCompare(b.kind === "assignment" ? b.due : b.start));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const startIso = localInputToIso(start, timezone);
    const endIso = localInputToIso(end, timezone);
    const raw = kind === "assignment" ? { id: newId(), kind, title, due: startIso } : { id: newId(), kind, title, start: startIso, end: endIso };
    const checked = parseManualCommitment(raw);
    if (!checked.ok) return setMessage({ error: true, text: checked.error });
    const error = onAdd(checked.commitment);
    if (error) return setMessage({ error: true, text: error });
    setMessage({ error: false, text: `Added "${checked.commitment.title}".` });
    setTitle("");
    setStart("");
    setEnd("");
  };

  return (
    <section className="panel" aria-labelledby="commitments-heading">
      <h2 id="commitments-heading">Your commitments ({commitments.length})</h2>
      <p className="muted small">
        Add things your calendar doesn&apos;t have. Exams get a preparation buffer; an assignment is a due time, not
        time you&apos;re busy. Times are in {timezone}. Commitments don&apos;t count as calendar coverage.
      </p>
      <form onSubmit={submit} className="commitment-form">
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ManualCommitmentKind)}>
            {MANUAL_COMMITMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MATH 135 midterm" required />
        </label>
        <label className="field">
          <span>{kind === "assignment" ? "Due" : "Starts"}</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        {kind !== "assignment" && (
          <label className="field">
            <span>Ends</span>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        )}
        <div className="form-actions">
          <button type="submit">Add commitment</button>
          <span role="status" className={message?.error ? "error-text" : "form-status"}>
            {message?.text}
          </span>
        </div>
      </form>
      {sorted.length > 0 && (
        <ul className="commitment-list">
          {sorted.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{KIND_LABELS[c.kind].replace(" (due time)", "")}:</strong> {c.title} ·{" "}
                {c.kind === "assignment" ? `due ${formatMoment(Date.parse(c.due), timezone)}` : formatRange(Date.parse(c.start), Date.parse(c.end), timezone)}
              </span>
              <button type="button" className="secondary small-button" aria-label={`Delete ${c.title}`} onClick={() => onRemove(c.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
