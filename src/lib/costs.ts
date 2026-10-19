import { isMultiDay } from "./deadline";
import { DEFAULT_CURRENCY } from "./profileStorage";
import type { Money, Opportunity } from "./types";

export type CostKey = "registration" | "travel" | "lodging";

export interface CostLine {
  key: CostKey;
  label: string;
  /** `null` = unknown. */
  amount: Money | null;
  note: string | null;
}

export interface CostSummary {
  lines: CostLine[];
  /** Labels of the lines whose amount is unknown. */
  missing: string[];
  /**
   * Sum of the known lines, or `null` when nothing is known or the known
   * lines use different currencies. Only show it as a "total" when
   * `missing` is empty; otherwise it must be labelled as a partial sum.
   */
  knownTotal: Money | null;
  complete: boolean;
}

const ZERO = (currency: string): Money => ({ amount: 0, currency });

export function summarizeCosts(opp: Opportunity): CostSummary {
  const currency = opp.registrationFee?.currency ?? opp.travelCostEstimate?.currency ?? DEFAULT_CURRENCY;
  const lines: CostLine[] = [];

  lines.push({
    key: "registration",
    label: "Registration fee",
    amount: opp.registrationFee,
    note: opp.registrationFee === null ? "Not stated by the source" : opp.registrationFee.amount === 0 ? "Free" : null,
  });

  if (opp.format === "online") {
    lines.push({ key: "travel", label: "Travel", amount: ZERO(currency), note: "Online, so no travel" });
  } else if (opp.travelSupport === "full") {
    lines.push({ key: "travel", label: "Travel", amount: ZERO(currency), note: "Covered by the organizer" });
  } else {
    const notes: string[] = [];
    if (opp.travelCostEstimate === null) notes.push("Not estimated");
    else notes.push("Source estimate, not from your starting location");
    if (opp.travelSupport === "partial") notes.push("organizer covers part of it");
    if (opp.format === "hybrid") notes.push("$0 if you join online");
    lines.push({ key: "travel", label: "Travel", amount: opp.travelCostEstimate, note: notes.join("; ") });
  }

  if (opp.format !== "online" && isMultiDay(opp)) {
    if (opp.lodgingSupport === "full") {
      lines.push({ key: "lodging", label: "Lodging", amount: ZERO(currency), note: "Provided by the organizer" });
    } else {
      lines.push({
        key: "lodging",
        label: "Lodging",
        amount: null,
        note:
          opp.lodgingSupport === "partial"
            ? "Partly provided; remaining cost not estimated"
            : "Multi-day event; lodging cost not estimated",
      });
    }
  }

  const known = lines.flatMap((l) => (l.amount ? [l.amount] : []));
  const missing = lines.filter((l) => l.amount === null).map((l) => l.label);
  const sameCurrency = known.every((m) => m.currency === known[0]?.currency);
  const knownTotal =
    known.length > 0 && sameCurrency
      ? { amount: known.reduce((sum, m) => sum + m.amount, 0), currency: known[0].currency }
      : null;

  return { lines, missing, knownTotal, complete: missing.length === 0 && knownTotal !== null };
}

export function formatMoney(m: Money): string {
  const digits = Number.isInteger(m.amount) ? 0 : 2;
  // en-CA prints CAD as "$40" and any other currency with a prefix (e.g. "US$40"),
  // so a stray foreign amount is never mistaken for dollars CAD.
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m.amount);
}
