import { formatMoney, type CostSummary } from "@/lib/costs";
import type { Opportunity } from "@/lib/types";
import { EvidenceNote } from "./EvidenceNote";

const EVIDENCE_FIELD = { registration: "registrationFee", travel: "travelCostEstimate", lodging: "lodgingSupport" } as const;

/**
 * Lists each known cost separately. A total is shown only when every cost is
 * known; otherwise we show a clearly-labelled partial sum and name what's missing.
 */
export function CostList({ costs, opportunity, showEvidence }: { costs: CostSummary; opportunity?: Opportunity; showEvidence?: boolean }) {
  return (
    <div className="costs">
      <ul className="cost-lines">
        {costs.lines.map((line) => {
          const evidence = !showEvidence
            ? undefined
            : line.key === "travel"
              ? (opportunity?.evidence.travelCostEstimate ?? opportunity?.evidence.travelSupport)
              : opportunity?.evidence[EVIDENCE_FIELD[line.key]];
          return (
            <li key={line.key}>
              <span className="cost-label">{line.label}</span>
              <span className={line.amount ? "cost-amount" : "cost-amount unknown"}>
                {line.amount ? formatMoney(line.amount) : "Unknown"}
              </span>
              {line.note && <span className="cost-note">{line.note}</span>}
              {evidence && <EvidenceNote evidence={evidence} />}
            </li>
          );
        })}
      </ul>
      <p className="cost-total">
        {costs.complete && costs.knownTotal ? (
          <>
            Total: <strong>{formatMoney(costs.knownTotal)}</strong>
          </>
        ) : costs.knownTotal ? (
          <>
            Known so far: <strong>{formatMoney(costs.knownTotal)}</strong>. Not included: {costs.missing.join(", ")}{" "}
            (unknown)
          </>
        ) : (
          <>No total: {costs.missing.length ? `${costs.missing.join(", ")} unknown` : "costs use different currencies"}</>
        )}
      </p>
    </div>
  );
}
