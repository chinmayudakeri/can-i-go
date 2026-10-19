"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StateMessage } from "@/components/StateMessage";
import { useProfile } from "@/hooks/useProfile";
import { YEAR_LABELS } from "@/lib/eligibility";
import { TOPICS, TRANSPORT_LABELS } from "@/lib/format";
import { EMPTY_PROFILE } from "@/lib/profileStorage";
import { PROGRAMS, type ExperienceLevel, type FormatPreference, type Program, type StudentProfile, type StudyYear, type Transport } from "@/lib/types";

export default function ProfilePage() {
  const { state, save, remove } = useProfile();

  return (
    <>
      <div className="page-head">
        <h1>Your profile</h1>
        <p className="muted">
          Used to check eligibility and explain why events fit you. Saved only in this browser (localStorage). Nothing
          is sent anywhere.
        </p>
      </div>
      {state.status === "loading" ? (
        <StateMessage kind="loading" title="Loading your profile…" />
      ) : state.status === "error" ? (
        <StateMessage kind="error" title="Couldn't read your saved profile">
          <p>{state.error}</p>
          <p>Your browser may be blocking storage for this site. You can still try saving a new profile below.</p>
          <ProfileForm initial={null} onSave={save} onDelete={remove} />
        </StateMessage>
      ) : (
        <ProfileForm initial={state.profile} onSave={save} onDelete={remove} />
      )}
    </>
  );
}

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "deleted" } | { kind: "error"; message: string };

function ProfileForm({
  initial,
  onSave,
  onDelete,
}: {
  initial: StudentProfile | null;
  onSave: (p: StudentProfile) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<StudentProfile>(initial ?? EMPTY_PROFILE);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const set = <K extends keyof StudentProfile>(key: K, value: StudentProfile[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus({ kind: "idle" });
  };
  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter((x) => x !== value));

  // Pick up changes made in another tab.
  useEffect(() => setDraft(initial ?? EMPTY_PROFILE), [initial]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    try {
      onSave({ ...draft, university: draft.university.trim(), startingLocation: draft.startingLocation.trim() });
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Could not save." });
    }
  };

  const handleDelete = () => {
    if (!window.confirm("Delete your saved profile from this browser? This can't be undone.")) return;
    try {
      onDelete();
      setDraft(EMPTY_PROFILE);
      setStatus({ kind: "deleted" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Could not delete." });
    }
  };

  const numberOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));

  return (
    <form className="profile-form" onSubmit={handleSubmit}>
      <fieldset>
        <legend>Studies</legend>
        <label className="field">
          <span>University</span>
          <input value={draft.university} onChange={(e) => set("university", e.target.value)} autoComplete="organization" />
        </label>
        <label className="field">
          <span>Program</span>
          <select value={draft.program ?? ""} onChange={(e) => set("program", (e.target.value || null) as Program | null)}>
            <option value="">Not set</option>
            {PROGRAMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Year of study</span>
          <select value={draft.year ?? ""} onChange={(e) => set("year", (e.target.value || null) as StudyYear | null)}>
            <option value="">Not set</option>
            {Object.entries(YEAR_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Experience</span>
          <select
            value={draft.experience ?? ""}
            onChange={(e) => set("experience", (e.target.value || null) as ExperienceLevel | null)}
          >
            <option value="">Not set</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Interests</legend>
        <div className="check-grid">
          {TOPICS.map((t) => (
            <label key={t} className="check">
              <input
                type="checkbox"
                checked={draft.interests.includes(t)}
                onChange={(e) => set("interests", toggle(draft.interests, t, e.target.checked))}
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Getting there</legend>
        <label className="field">
          <span>Attend</span>
          <select
            value={draft.formatPreference}
            onChange={(e) => set("formatPreference", e.target.value as FormatPreference)}
          >
            <option value="either">Online or in person</option>
            <option value="online">Online only</option>
            <option value="in-person">In person only</option>
          </select>
        </label>
        <label className="field">
          <span>Starting location</span>
          <input
            value={draft.startingLocation}
            onChange={(e) => set("startingLocation", e.target.value)}
            placeholder="City, e.g. Waterloo, ON"
          />
        </label>
        <label className="field">
          <span>Max travel time (hours, one way)</span>
          <input
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={draft.maxTravelHours ?? ""}
            onChange={(e) => set("maxTravelHours", numberOrNull(e.target.value))}
          />
        </label>
        <div className="field">
          <span>Transport you can use</span>
          <div className="check-grid">
            {(Object.entries(TRANSPORT_LABELS) as [Transport, string][]).map(([v, label]) => (
              <label key={v} className="check">
                <input
                  type="checkbox"
                  checked={draft.transport.includes(v)}
                  onChange={(e) => set("transport", toggle(draft.transport, v, e.target.checked))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Budget</legend>
        <label className="field">
          <span>Max spend per event ({draft.budgetCurrency})</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.budget ?? ""}
            onChange={(e) => set("budget", numberOrNull(e.target.value))}
          />
        </label>
      </fieldset>

      <div className="form-actions">
        <button type="submit">Save profile</button>
        <button type="button" className="danger" onClick={handleDelete} disabled={!initial}>
          Delete saved profile
        </button>
        <span role="status" className="form-status">
          {status.kind === "saved" && (
            <>
              Saved. <Link href="/">See your matches →</Link>
            </>
          )}
          {status.kind === "deleted" && "Profile deleted from this browser."}
          {status.kind === "error" && <span className="error-text">{status.message}</span>}
        </span>
      </div>
    </form>
  );
}
