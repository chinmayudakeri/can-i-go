import { COUNTRY_NOT_STATED } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { parseOpportunities } from "@/lib/validate";
import { upsertListing } from "./dedupe";
import { NEEDS_REVIEWER_TIMEZONE, ReviewInputError, TIMEZONE_CONFIRMED_LABEL, confirmTimezone } from "./timezoneDraft";
import { DERIVED_FROM_LOCATION, type FieldReport, type IngestState, type PendingRecord } from "./types";

/** Pure review decisions; scripts/review.ts only does terminal I/O around these. */

export interface ReviewData {
  pending: PendingRecord[];
  listings: Opportunity[];
  state: IngestState;
}

export interface ApproveResult extends ReviewData {
  action: "added" | "updated";
  id: string;
  conflicts: string[];
}

/** What the reviewer typed for a record flagged "needs reviewer timezone". */
export interface ReviewerTimezone {
  timezone: string;
  note: string;
  now?: Date;
}

/**
 * Validates the record as a real listing, merges it into listings
 * (deduplicating), and marks its source approved. A record flagged "needs
 * reviewer timezone" can only be approved with a valid IANA zone and a note
 * typed by the reviewer; anything else throws ReviewInputError. The zone
 * comes only from that input, never from the page or the model.
 */
export function approvePending(data: ReviewData, index: number, reviewerTimezone?: ReviewerTimezone): ApproveResult {
  const record = data.pending[index];
  if (!record) throw new RangeError(`no pending record at ${index}`);
  let opportunity: Opportunity;
  if (record.flag === NEEDS_REVIEWER_TIMEZONE) {
    if (!reviewerTimezone) throw new ReviewInputError(`can't approve: ${NEEDS_REVIEWER_TIMEZONE}. Enter an IANA timezone and how you verified it.`);
    opportunity = confirmTimezone(record.draft, reviewerTimezone);
    if (record.updateOf) opportunity = { ...opportunity, id: record.updateOf };
  } else {
    if (reviewerTimezone) throw new ReviewInputError("this record's timezone was derived from its stated location; it can't be overridden");
    opportunity = record.opportunity;
  }
  parseOpportunities([opportunity], `pending[${index}]`, { real: true });
  const { listings, action, id, conflicts } = upsertListing(data.listings, opportunity);
  return {
    pending: data.pending.filter((_, i) => i !== index),
    listings,
    state: {
      ...data.state,
      [record.itemKey]: { textHash: record.textHash, lastFetched: record.fetchedAt, outcome: "approved", listingId: id },
    },
    action,
    id,
    conflicts,
  };
}

/** One line for review: how this record's timezone was (or must be) decided. */
export function describeTimezoneStatus(record: PendingRecord): string {
  if (record.flag === NEEDS_REVIEWER_TIMEZONE) {
    const why = record.fields.find((f) => f.field === "timezone")?.reason;
    return terminalSafe(
      `⚠ NEEDS REVIEWER TIMEZONE${why ? ` (${why})` : ""}. Local times as stated: ${record.draft.startLocal} → ${record.draft.endLocal}` +
        `${record.draft.deadlineLocal ? `, deadline ${record.draft.deadlineLocal}` : ""}. Approving asks for an IANA zone and how you verified it.`,
    );
  }
  return describeListingTimezone(record.opportunity);
}

export function describeListingTimezone(o: Opportunity): string {
  const c = o.timezoneConfirmation;
  if (c) return terminalSafe(`${TIMEZONE_CONFIRMED_LABEL}: ${o.timezone}, on ${c.confirmedOn}. Note: ${c.note}`);
  return terminalSafe(`Timezone: ${o.timezone} (${DERIVED_FROM_LOCATION})`);
}

/** Drops the record and remembers the rejection, so the same page text isn't proposed again. */
export function rejectPending(data: ReviewData, index: number): ReviewData {
  const record = data.pending[index];
  if (!record) throw new RangeError(`no pending record at ${index}`);
  return {
    pending: data.pending.filter((_, i) => i !== index),
    listings: data.listings,
    state: { ...data.state, [record.itemKey]: { textHash: record.textHash, lastFetched: record.fetchedAt, outcome: "rejected" } },
  };
}

/**
 * Page-derived strings go to the terminal, so strip control characters
 * (including ESC, which would let a page inject terminal escape sequences).
 */
export function terminalSafe(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "");
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (line) lines.push(line);
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        line = "";
        continue;
      }
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/** Readable and wrappable: objects as "key: value, …", lists comma-separated. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(", ") : "[]";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${JSON.stringify(x)}`).join(", ");
  return String(v);
}
/** Location parts in order, with an explicit "Country not stated" instead of a null country. */
function formatLocation(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return formatValue(v);
  const loc = v as Record<string, unknown>;
  const parts = (["venue", "city", "region"] as const).map((k) => `${k}: ${loc[k] === null || loc[k] === undefined ? "null" : JSON.stringify(loc[k])}`);
  parts.push(typeof loc.country === "string" && loc.country ? `country: ${JSON.stringify(loc.country)}` : COUNTRY_NOT_STATED);
  return parts.join(", ");
}

const MARK: Record<FieldReport["status"], string> = { kept: "✓", discarded: "✗", missing: "·" };

/** Two columns: field/value/basis on the left, the supporting quote on the right. */
export function formatFieldTable(fields: FieldReport[], totalWidth = 100): string {
  const left = Math.max(30, Math.floor(totalWidth * 0.42));
  const right = Math.max(20, totalWidth - left - 3);
  const rows: string[] = [];
  const order: FieldReport["status"][] = ["kept", "discarded"];
  for (const status of order) {
    const group = fields.filter((f) => f.status === status);
    if (!group.length) continue;
    rows.push(status === "kept" ? "KEPT (quote verified on the page)" : "DISCARDED (set to null)");
    for (const f of group) {
      const basis = f.basis && f.basis !== "stated" ? ` [${f.basis.toUpperCase()}]` : "";
      const value = f.field === "location" ? formatLocation(f.value) : formatValue(f.value);
      const leftText = terminalSafe(`${MARK[f.status]} ${f.field}${basis}: ${value}`);
      const rightText =
        terminalSafe(f.quote ? `“${f.quote}”` : "(no quote)") +
        (f.timeQuote ? `\ntime: “${terminalSafe(f.timeQuote)}”` : "") +
        (f.reason ? `\n→ ${terminalSafe(f.reason)}` : "");
      const l = wrap(leftText, left);
      const r = wrap(rightText, right);
      for (let i = 0; i < Math.max(l.length, r.length); i++) rows.push(`${(l[i] ?? "").padEnd(left)} │ ${r[i] ?? ""}`);
    }
    rows.push("");
  }
  const missing = fields.filter((f) => f.status === "missing").map((f) => (f.reason ? `${f.field} (${f.reason})` : f.field));
  if (missing.length) rows.push(terminalSafe(`Not stated (null): ${missing.join(", ")}`));
  return rows.join("\n");
}

export interface RejectedRecord {
  itemKey: string;
  sourceUrl: string;
  reason: string;
  fields: FieldReport[];
}

/**
 * `npm run ingest -- --show-rejected`: every field of each rejected record
 * (value, quote, basis, kept or discarded and why). Any `secrets` (the API
 * key) are redacted from the output, even though page text should never
 * contain them.
 */
export function formatRejected(rejected: RejectedRecord[], width = 100, secrets: string[] = []): string {
  const redact = (s: string) => secrets.filter((k) => k.length >= 8).reduce((out, k) => out.replaceAll(k, "[redacted]"), s);
  return rejected
    .map((r) => {
      const header = terminalSafe(`REJECTED ${r.itemKey}\nSource: ${r.sourceUrl}\nReason: ${r.reason}`);
      const body = r.fields.length ? formatFieldTable(r.fields, width) : "(no fields: the model output could not be read)";
      return redact(`${"═".repeat(width)}\n${header}\n${"─".repeat(width)}\n${body}`);
    })
    .join("\n\n");
}
