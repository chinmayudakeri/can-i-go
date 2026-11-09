"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadFile } from "@/components/download";
import { ALL_STORAGE_KEYS, deleteAllData, exportAllData } from "@/lib/privacyData";

type Usage = { key: string; bytes: number | null }[];

export default function PrivacyPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  const measure = useCallback(() => {
    try {
      setUsage(ALL_STORAGE_KEYS.map(({ key }) => ({ key, bytes: window.localStorage.getItem(key)?.length ?? null })));
    } catch {
      setUsage(null);
    }
  }, []);
  useEffect(measure, [measure]);

  const exportData = () => {
    try {
      const data = exportAllData(window.localStorage, new Date());
      downloadFile("can-i-go-my-data.json", JSON.stringify(data, null, 2), "application/json");
      setStatus({ error: false, text: "Downloaded can-i-go-my-data.json." });
    } catch (e) {
      setStatus({ error: true, text: `Couldn't export: ${e instanceof Error ? e.message : "storage unavailable"}` });
    }
  };

  const deleteData = () => {
    if (!window.confirm("Delete your profile, calendars, commitments and shortlist from this browser? This can't be undone.")) return;
    try {
      deleteAllData(window.localStorage);
      measure();
      setStatus({ error: false, text: "All your Can I Go? data was deleted from this browser." });
    } catch (e) {
      setStatus({ error: true, text: `Couldn't delete: ${e instanceof Error ? e.message : "storage unavailable"}` });
    }
  };

  return (
    <article className="detail">
      <div className="page-head">
        <h1>Privacy</h1>
        <p className="muted">There are no accounts and no server-side storage. Here is exactly what happens to your data.</p>
      </div>

      <section className="panel" aria-labelledby="stored-heading">
        <h2 id="stored-heading">Stored in this browser only</h2>
        <p>Everything you enter is saved in this browser&apos;s localStorage on this device. Clearing site data, or the button below, removes it.</p>
        <table className="checks">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Storage key</th>
              <th scope="col">Saved now</th>
            </tr>
          </thead>
          <tbody>
            {ALL_STORAGE_KEYS.map(({ key, what }) => {
              const bytes = usage?.find((u) => u.key === key)?.bytes;
              return (
                <tr key={key}>
                  <td>{what}</td>
                  <td>
                    <code>{key}</code>
                  </td>
                  <td>{usage === null ? "Unknown" : bytes == null ? "Nothing" : `${(bytes / 1024).toFixed(1)} KB`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-labelledby="never-heading">
        <h2 id="never-heading">Never sent anywhere</h2>
        <ul>
          <li>Your calendar files and their events. They are read in the browser; the file is never uploaded.</li>
          <li>Commitments you enter, your shortlist, application status and notes.</li>
          <li>Your profile, including your attendance assumptions (travel time, buffers).</li>
          <li>Feasibility results. They are worked out in your browser each time you open a page.</li>
        </ul>
        <p className="small muted">
          We never ask for citizenship, residency or age. Downloads (your .ics shortlist, your data export) are made in the
          browser and saved straight to your device.
        </p>
      </section>

      <section className="panel" aria-labelledby="ai-heading">
        <h2 id="ai-heading">What is sent to the AI provider</h2>
        <p>
          Only <strong>public event page text</strong>, during ingestion. The developer runs ingestion from their own terminal
          to find and extract event details. The page text is sent to Google&apos;s AI API (free tier), and every extracted
          detail is checked against the page and reviewed by a person before it appears here.
        </p>
        <p>
          The website never calls an AI. Your calendar, commitments, profile and shortlist are never sent to the AI provider
          or anyone else.
        </p>
      </section>

      <section className="panel" aria-labelledby="control-heading">
        <h2 id="control-heading">Your data</h2>
        <div className="form-actions">
          <button type="button" onClick={exportData}>
            Export my data
          </button>
          <button type="button" className="danger" onClick={deleteData}>
            Delete my data
          </button>
        </div>
        <p role="status" className={status?.error ? "error-text" : "form-status"}>
          {status?.text}
        </p>
        <p className="small muted">
          Export saves everything listed above as one JSON file. Delete removes all of it. You can also delete just your{" "}
          <Link href="/profile">profile</Link> or your <Link href="/calendar">calendar data</Link>.
        </p>
      </section>
    </article>
  );
}
