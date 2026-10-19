import type { Relevance, ReasonTone } from "@/lib/relevance";

const ICONS: Record<ReasonTone, string> = { positive: "+", negative: "−", neutral: "·" };

export function RelevanceReasons({ relevance }: { relevance: Relevance }) {
  const { reasons, forCount, againstCount } = relevance;
  return (
    <div className="relevance">
      <p className="relevance-summary">
        Why it might fit you
        {reasons.some((r) => r.kind !== "profile") && `: ${forCount} for, ${againstCount} against`}
      </p>
      <ul>
        {reasons.map((r) => (
          <li key={r.text} className={`reason reason-${r.tone}`}>
            <span className="reason-icon" aria-label={r.tone}>
              {ICONS[r.tone]}
            </span>
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
