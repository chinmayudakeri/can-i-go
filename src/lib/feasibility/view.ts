import type { FeasibilityResult } from "./types";

export const NOT_CHECKED_LABEL = "Attendance feasibility has not been checked";

export interface FeasibilityView {
  label: string;
  tone: "bad" | "warn" | "ok" | "muted";
  /** One plain sentence under the label. */
  detail: string;
  /** No calendar is connected, so free time can't be confirmed. */
  notChecked: boolean;
}

/**
 * The headline for a feasibility result. Hard conflicts always lead, even
 * with no calendar connected (they can come from manual commitments or the
 * shortlist). Without a calendar we never claim the student is free.
 */
export function feasibilityView(result: FeasibilityResult, calendarsConnected: boolean): FeasibilityView {
  const hard = result.hardConflicts.length;
  const strong = result.softWarnings.filter((w) => w.strong).length;
  const soft = result.softWarnings.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (hard) {
    return {
      label: `${plural(hard, "conflict")} found`,
      tone: "bad",
      detail: calendarsConnected ? result.summary : `${result.summary} No calendar is connected, so there may be more.`,
      notChecked: !calendarsConnected,
    };
  }
  if (!calendarsConnected) {
    return { label: NOT_CHECKED_LABEL, tone: "muted", detail: "Import a calendar to check this event against your schedule.", notChecked: true };
  }
  if (result.status === "calendar coverage incomplete") {
    return { label: "Calendar coverage incomplete", tone: "warn", detail: result.summary, notChecked: false };
  }
  if (result.status === "needs confirmation") {
    return { label: "Needs confirmation", tone: "warn", detail: result.summary, notChecked: false };
  }
  if (strong) {
    return { label: `No time conflicts, ${plural(strong, "strong warning")}`, tone: "warn", detail: result.summary, notChecked: false };
  }
  return { label: soft ? `No conflicts found, ${plural(soft, "warning")}` : "No conflicts found", tone: "ok", detail: result.summary, notChecked: false };
}
