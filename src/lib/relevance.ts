import { formatMoney, type CostSummary } from "./costs";
import type { Opportunity, StudentProfile } from "./types";

export type ReasonTone = "positive" | "negative" | "neutral";

export interface RelevanceReason {
  kind: "interest" | "beginner" | "budget" | "travel" | "format" | "profile";
  tone: ReasonTone;
  text: string;
}

export interface Relevance {
  reasons: RelevanceReason[];
  /** Number of reasons for and against. Shown in the UI and used to sort. */
  forCount: number;
  againstCount: number;
}

const normalize = (s: string) => s.trim().toLowerCase();

export function explainRelevance(
  opp: Opportunity,
  profile: StudentProfile | null,
  costs: CostSummary,
): Relevance {
  const reasons: RelevanceReason[] = [];

  if (!profile) {
    reasons.push({ kind: "profile", tone: "neutral", text: "Add a profile to see why this might fit you." });
    return tally(reasons);
  }

  // Interests
  const interests = new Set(profile.interests.map(normalize));
  const shared = opp.tags.filter((t) => interests.has(normalize(t)));
  if (shared.length > 0) {
    reasons.push({ kind: "interest", tone: "positive", text: `Matches your interests: ${shared.join(", ")}` });
  }

  // Beginner support
  if (profile.experience === "beginner") {
    if (opp.beginnerFriendly === true) {
      reasons.push({ kind: "beginner", tone: "positive", text: "Marked as beginner friendly" });
    } else if (opp.beginnerFriendly === false) {
      reasons.push({ kind: "beginner", tone: "negative", text: "Not aimed at beginners" });
    } else {
      reasons.push({ kind: "beginner", tone: "neutral", text: "Beginner support isn't stated" });
    }
  }

  // Format preference
  if (profile.formatPreference === "online" && opp.format === "in-person") {
    reasons.push({ kind: "format", tone: "negative", text: "In person only, and you prefer online" });
  } else if (profile.formatPreference === "in-person" && opp.format === "online") {
    reasons.push({ kind: "format", tone: "negative", text: "Online only, and you prefer in person" });
  }

  // Travel
  if (opp.format === "online") {
    if (profile.formatPreference !== "in-person") {
      reasons.push({ kind: "travel", tone: "positive", text: "Online, so no travel needed" });
    }
  } else if (opp.location) {
    const start = normalize(profile.startingLocation);
    const city = opp.location.city;
    if (!start) {
      reasons.push({ kind: "travel", tone: "neutral", text: "Add a starting location to compare travel" });
    } else if (start.includes(normalize(city))) {
      reasons.push({ kind: "travel", tone: "positive", text: `In ${city}, where you're starting from` });
    } else {
      const limit = profile.maxTravelHours !== null ? ` (your limit: ${profile.maxTravelHours} h)` : "";
      reasons.push({
        kind: "travel",
        tone: "neutral",
        text: `Travel time from ${profile.startingLocation.trim()} to ${city} not estimated yet${limit}`,
      });
    }
    if (opp.travelSupport === "full") {
      reasons.push({ kind: "travel", tone: "positive", text: "Organizer covers travel" });
    }
  }

  // Budget
  if (profile.budget !== null) {
    const budget = { amount: profile.budget, currency: profile.budgetCurrency };
    const known = costs.knownTotal;
    if (!known || known.currency !== budget.currency) {
      reasons.push({ kind: "budget", tone: "neutral", text: "Can't compare costs to your budget yet" });
    } else if (known.amount > budget.amount) {
      reasons.push({
        kind: "budget",
        tone: "negative",
        text: `${costs.complete ? "Costs" : "Known costs alone"} (${formatMoney(known)}) exceed your ${formatMoney(budget)} budget`,
      });
    } else if (costs.complete) {
      reasons.push({
        kind: "budget",
        tone: "positive",
        text: `Costs (${formatMoney(known)}) fit your ${formatMoney(budget)} budget`,
      });
    } else {
      reasons.push({
        kind: "budget",
        tone: "neutral",
        text: `Known costs fit your budget, but ${costs.missing.join(" and ").toLowerCase()} ${costs.missing.length > 1 ? "are" : "is"} unknown`,
      });
    }
  }

  return tally(reasons);
}

function tally(reasons: RelevanceReason[]): Relevance {
  return {
    reasons,
    forCount: reasons.filter((r) => r.tone === "positive").length,
    againstCount: reasons.filter((r) => r.tone === "negative").length,
  };
}
