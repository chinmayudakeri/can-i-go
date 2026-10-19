import type { DeadlineStatus } from "@/lib/deadline";
import { describeDeadline } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

export function DeadlineText({ deadline, opportunity, now }: { deadline: DeadlineStatus; opportunity: Opportunity; now: Date }) {
  const { text, tone } = describeDeadline(deadline, opportunity, now);
  return <p className={`deadline deadline-${tone}`}>{text}</p>;
}
