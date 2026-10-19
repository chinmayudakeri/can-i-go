import type { Opportunity } from "@/lib/types";
import { parseOpportunities } from "@/lib/validate";
import { upsertListing } from "./dedupe";
import type { FieldReport, IngestState, PendingRecord } from "./types";

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

/** Validates the record as a real listing, merges it into listings (deduplicating), and marks its source approved. */
export function approvePending(data: ReviewData, index: number): ApproveResult {
  const record = data.pending[index];
  if (!record) throw new RangeError(`no pending record at ${index}`);
  parseOpportunities([record.opportunity], `pending[${index}]`, { real: true });
  const { listings, action, id, conflicts } = upsertListing(data.listings, record.opportunity);
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

const formatValue = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
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
      const basis = f.basis === "inferred" ? " [INFERRED]" : "";
      const leftText = terminalSafe(`${MARK[f.status]} ${f.field}${basis}: ${formatValue(f.value)}`);
      const rightText = terminalSafe(f.quote ? `“${f.quote}”` : "(no quote)") + (f.reason ? `\n→ ${terminalSafe(f.reason)}` : "");
      const l = wrap(leftText, left);
      const r = wrap(rightText, right);
      for (let i = 0; i < Math.max(l.length, r.length); i++) rows.push(`${(l[i] ?? "").padEnd(left)} │ ${r[i] ?? ""}`);
    }
    rows.push("");
  }
  const missing = fields.filter((f) => f.status === "missing").map((f) => f.field);
  if (missing.length) rows.push(terminalSafe(`Not stated (null): ${missing.join(", ")}`));
  return rows.join("\n");
}
