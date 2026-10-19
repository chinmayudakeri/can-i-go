import type { Evidence } from "@/lib/types";

export function EvidenceNote({ evidence }: { evidence: Evidence }) {
  return (
    <span className="evidence">
      Source: “{evidence.quote}”{" "}
      <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
        view
      </a>
    </span>
  );
}
