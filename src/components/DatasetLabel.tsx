import { formatDate, sourceHost } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

/** "DEMO" for fictional events; source site and last-verified date for real listings. */
export function DatasetLabel({ opportunity: o }: { opportunity: Opportunity }) {
  if (o.dataset !== "real") {
    return (
      <span className="chip chip-demo" title="Fictional demo event">
        DEMO
      </span>
    );
  }
  return (
    <span className="chip chip-source">
      Source: {sourceHost(o.sourceUrl)} · Verified {formatDate(`${o.lastVerified}T12:00:00Z`, "UTC")}
    </span>
  );
}
