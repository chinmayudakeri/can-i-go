import { describeTimezoneSource } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

/** Shows the event's timezone and, for real listings, how it was decided. */
export function TimezoneSource({ opportunity: o }: { opportunity: Opportunity }) {
  const source = describeTimezoneSource(o);
  return (
    <>
      {o.timezone}
      {source && (
        <span className={source.detail ? "timezone-source timezone-confirmed" : "timezone-source"}>
          {" "}
          · <strong>{source.label}</strong>
          {source.detail && <span className="muted small"> ({source.detail})</span>}
        </span>
      )}
    </>
  );
}
