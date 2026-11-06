import { isValidIsoDateTime } from "../validate";
import { MANUAL_COMMITMENT_KINDS, type Commitment, type ManualCommitmentKind } from "./types";

export type CommitmentCheck = { ok: true; commitment: Commitment } | { ok: false; error: string };

/**
 * Checks a commitment entered by hand. An assignment is a deadline (`due`),
 * not a block of time; every other kind needs a start and an end.
 */
export function parseManualCommitment(raw: unknown): CommitmentCheck {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fail = (error: string): CommitmentCheck => ({ ok: false, error });
  if (typeof r.id !== "string" || !r.id.trim()) return fail("Missing id.");
  if (typeof r.title !== "string" || !r.title.trim()) return fail("Give it a name.");
  if (!MANUAL_COMMITMENT_KINDS.includes(r.kind as ManualCommitmentKind)) return fail(`Unknown kind "${String(r.kind)}".`);
  const title = r.title.trim();

  if (r.kind === "assignment") {
    if (!isValidIsoDateTime(r.due)) return fail("An assignment needs a due date and time.");
    return { ok: true, commitment: { id: r.id, kind: "assignment", title, due: r.due } };
  }
  if (!isValidIsoDateTime(r.start) || !isValidIsoDateTime(r.end)) return fail("Needs a start and an end.");
  if (Date.parse(r.end) <= Date.parse(r.start)) return fail("Must end after it starts.");
  return {
    ok: true,
    commitment: {
      id: r.id,
      kind: r.kind as Exclude<ManualCommitmentKind, "assignment">,
      title,
      start: r.start,
      end: r.end,
      allDay: false,
      busy: true,
      tentative: false,
      calendarName: null,
    },
  };
}
