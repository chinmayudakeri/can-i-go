import type {
  EligibilityRequirements,
  Evidence,
  ExperienceLevel,
  Opportunity,
  Program,
  StudentProfile,
  StudyYear,
} from "./types";

export type EligibilityStatus = "matches" | "does-not-match" | "needs-confirmation";

export interface EligibilityCheck {
  field: keyof EligibilityRequirements;
  label: string;
  status: EligibilityStatus;
  /** What the source requires, in plain language. */
  requirement: string;
  /** Why we reached this status. */
  explanation: string;
  evidence: Evidence | null;
}

export interface EligibilityResult {
  status: EligibilityStatus;
  checks: EligibilityCheck[];
}

export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  matches: "Matches",
  "does-not-match": "Does not match",
  "needs-confirmation": "Needs confirmation",
};

export const YEAR_LABELS: Record<StudyYear, string> = {
  "1": "1st year",
  "2": "2nd year",
  "3": "3rd year",
  "4": "4th year",
  "5+": "5th year or later",
  graduate: "Graduate student",
};

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A listed university matches if it appears in the profile value, ignoring case and spacing. */
function textMatches(profileValue: string, accepted: string[]): boolean {
  const p = normalize(profileValue);
  return accepted.some((a) => p.includes(normalize(a)));
}

function combine(statuses: EligibilityStatus[]): EligibilityStatus {
  if (statuses.includes("does-not-match")) return "does-not-match";
  if (statuses.includes("needs-confirmation")) return "needs-confirmation";
  return "matches";
}

type CheckInput<T> = {
  field: keyof EligibilityRequirements;
  label: string;
  requirement: T[] | "any" | null;
  profileValue: T | null;
  profileFieldName: string;
  describe: (v: T) => string;
  matches: (profileValue: T, accepted: T[]) => boolean;
  /** Free-text fields can fail on spelling differences, so we suggest confirming. */
  freeText?: boolean;
  /** Profile values that can't be checked against a list (e.g. program "Other"). */
  unverifiable?: (profileValue: T) => boolean;
};

function checkListRequirement<T>(input: CheckInput<T>, evidence: Evidence | null, hasProfile: boolean): EligibilityCheck {
  const { field, label, requirement, profileValue, profileFieldName, describe, matches, freeText, unverifiable } = input;
  const base = { field, label, evidence };

  if (requirement === null) {
    return {
      ...base,
      status: "needs-confirmation",
      requirement: "Not stated by the source",
      explanation: `The source doesn't say whether ${label.toLowerCase()} is restricted. Check with the organizer.`,
    };
  }
  if (requirement === "any") {
    return { ...base, status: "matches", requirement: "Open to all", explanation: "No restriction on this." };
  }

  const reqText = requirement.map(describe).join(", ");
  if (!hasProfile || profileValue === null || (typeof profileValue === "string" && profileValue.trim() === "")) {
    return {
      ...base,
      status: "needs-confirmation",
      requirement: reqText,
      explanation: `Add your ${profileFieldName} to your profile to check this.`,
    };
  }
  if (unverifiable?.(profileValue)) {
    return {
      ...base,
      status: "needs-confirmation",
      requirement: reqText,
      explanation: `Your ${profileFieldName} is "${describe(profileValue)}", which can't be checked against this list. Confirm with the organizer.`,
    };
  }
  if (matches(profileValue, requirement)) {
    return {
      ...base,
      status: "matches",
      requirement: reqText,
      explanation: `Your ${profileFieldName} (${describe(profileValue)}) is accepted.`,
    };
  }
  return {
    ...base,
    status: "does-not-match",
    requirement: reqText,
    explanation: `Your ${profileFieldName} (${describe(profileValue)}) isn't in the accepted list.${
      freeText ? " If this is just a naming difference, confirm with the organizer." : ""
    }`,
  };
}

export function checkEligibility(opp: Opportunity, profile: StudentProfile | null): EligibilityResult {
  const req = opp.eligibility;
  const ev = (f: keyof EligibilityRequirements) => opp.evidence[`eligibility.${f}`] ?? null;
  const hasProfile = profile !== null;
  const checks: EligibilityCheck[] = [];

  // Student status
  {
    const base = { field: "studentStatusRequired" as const, label: "Student status", evidence: ev("studentStatusRequired") };
    if (req.studentStatusRequired === null) {
      checks.push({
        ...base,
        status: "needs-confirmation",
        requirement: "Not stated by the source",
        explanation: "The source doesn't say whether you must be a current student.",
      });
    } else if (!req.studentStatusRequired) {
      checks.push({ ...base, status: "matches", requirement: "Students and non-students", explanation: "No student requirement." });
    } else if (profile?.university.trim()) {
      checks.push({
        ...base,
        status: "matches",
        requirement: "Current students only",
        explanation: `You listed ${profile.university.trim()} as your university.`,
      });
    } else {
      checks.push({
        ...base,
        status: "needs-confirmation",
        requirement: "Current students only",
        explanation: "Add your university to your profile to check this.",
      });
    }
  }

  checks.push(
    checkListRequirement<string>(
      {
        field: "universities",
        label: "University",
        requirement: req.universities,
        profileValue: profile?.university ?? null,
        profileFieldName: "university",
        describe: (v) => v.trim(),
        matches: (v, accepted) => textMatches(v, accepted),
        freeText: true,
      },
      ev("universities"),
      hasProfile,
    ),
    checkListRequirement<Program>(
      {
        field: "programs",
        label: "Program",
        requirement: req.programs,
        profileValue: profile?.program ?? null,
        profileFieldName: "program",
        describe: (v) => v,
        // Both sides come from the same PROGRAMS list, so matching is exact.
        matches: (v, accepted) => accepted.includes(v),
        unverifiable: (v) => v === "Other",
      },
      ev("programs"),
      hasProfile,
    ),
    checkListRequirement<StudyYear>(
      {
        field: "years",
        label: "Year of study",
        requirement: req.years,
        profileValue: profile?.year ?? null,
        profileFieldName: "year of study",
        describe: (v) => YEAR_LABELS[v],
        matches: (v, accepted) => accepted.includes(v),
      },
      ev("years"),
      hasProfile,
    ),
    checkListRequirement<ExperienceLevel>(
      {
        field: "experienceLevels",
        label: "Experience level",
        requirement: req.experienceLevels,
        profileValue: profile?.experience ?? null,
        profileFieldName: "experience level",
        describe: (v) => v,
        matches: (v, accepted) => accepted.includes(v),
      },
      ev("experienceLevels"),
      hasProfile,
    ),
  );

  // Free-text conditions can't be checked automatically. `null` here means
  // "no extra conditions found", not a gap in a required field.
  for (const other of req.otherRequirements ?? []) {
    checks.push({
      field: "otherRequirements",
      label: "Other requirement",
      status: "needs-confirmation",
      requirement: other,
      explanation: "We can't check this automatically. Confirm it yourself.",
      evidence: ev("otherRequirements"),
    });
  }

  return { status: combine(checks.map((c) => c.status)), checks };
}
