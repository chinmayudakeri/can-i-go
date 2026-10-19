import { PROGRAMS, type ExperienceLevel, type FormatPreference, type Program, type StudentProfile, type StudyYear, type Transport } from "./types";

export const PROFILE_STORAGE_KEY = "can-i-go.profile.v1";

export const DEFAULT_CURRENCY = "CAD";
export const DEFAULT_STARTING_LOCATION = "Waterloo, ON";

export const EMPTY_PROFILE: StudentProfile = {
  university: "",
  program: null,
  year: null,
  interests: [],
  experience: null,
  startingLocation: DEFAULT_STARTING_LOCATION,
  maxTravelHours: null,
  transport: [],
  budget: null,
  budgetCurrency: DEFAULT_CURRENCY,
  formatPreference: "either",
};

const YEARS: StudyYear[] = ["1", "2", "3", "4", "5+", "graduate"];
const EXPERIENCE: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const FORMATS: FormatPreference[] = ["online", "in-person", "either"];
const TRANSPORT: Transport[] = ["walk-bike", "transit", "car", "train-bus", "plane"];

/** Minimal storage interface so tests can pass an in-memory fake. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LoadResult = { ok: true; profile: StudentProfile | null } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: T[]): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

/** Coerce stored JSON into a valid profile, dropping anything malformed. */
export function sanitizeProfile(raw: unknown): StudentProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    university: str(r.university),
    // Older saves held free text; anything not in the dropdown is dropped so the user re-picks.
    program: oneOf(r.program, [...PROGRAMS] as Program[]),
    year: oneOf(r.year, YEARS),
    interests: Array.isArray(r.interests) ? r.interests.filter((i): i is string => typeof i === "string") : [],
    experience: oneOf(r.experience, EXPERIENCE),
    // A saved empty string means the user cleared it on purpose; only a missing key gets the default.
    startingLocation: typeof r.startingLocation === "string" ? r.startingLocation : DEFAULT_STARTING_LOCATION,
    maxTravelHours: num(r.maxTravelHours),
    transport: Array.isArray(r.transport) ? r.transport.filter((t): t is Transport => TRANSPORT.includes(t)) : [],
    budget: num(r.budget),
    budgetCurrency: str(r.budgetCurrency) || DEFAULT_CURRENCY,
    formatPreference: oneOf(r.formatPreference, FORMATS) ?? "either",
  };
}

export function loadProfile(store: KeyValueStore): LoadResult {
  try {
    const raw = store.getItem(PROFILE_STORAGE_KEY);
    if (raw === null) return { ok: true, profile: null };
    return { ok: true, profile: sanitizeProfile(JSON.parse(raw)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read saved profile." };
  }
}

export function saveProfile(store: KeyValueStore, profile: StudentProfile): void {
  store.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function deleteProfile(store: KeyValueStore): void {
  store.removeItem(PROFILE_STORAGE_KEY);
}
