import { ELIGIBILITY_LABELS, type EligibilityStatus } from "@/lib/eligibility";

const ICONS: Record<EligibilityStatus, string> = {
  matches: "✓",
  "does-not-match": "✕",
  "needs-confirmation": "?",
};

export function EligibilityBadge({ status, small }: { status: EligibilityStatus; small?: boolean }) {
  return (
    <span className={`badge elig-${status}${small ? " badge-small" : ""}`}>
      <span aria-hidden>{ICONS[status]}</span> {ELIGIBILITY_LABELS[status]}
    </span>
  );
}
