/**
 * Which features each age gets.
 *
 * One table decides it, so the server, the screens and the reminders agree.
 * Rules of thumb:
 *   - Under 13: the parent runs the app. No photos sent to AI, no wearables,
 *     no weighing, no body-number tracking. Simple, game-like tools.
 *   - 13 to 17: more self-management, still no body weight on screen,
 *     parents get the weekly report and quiet alerts.
 *   - 18+: full toolset, including body weight, sweat tests and wearables.
 *   - Growth, school-day and overuse limits only apply while still growing / in school.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";

export type FeatureId =
  | "sweatTest" | "urineColor" | "sorenessMap" | "growth" | "asthma" | "concussion"
  | "cycle" | "breathing" | "burnoutCheck" | "crisisLine" | "warmup" | "schoolDay" | "travel"
  | "recipes" | "mealPlan" | "eatingOut" | "snapPlate" | "appleHealth" | "garmin" | "whoop" | "oura"
  | "bodyWeight" | "sessionLoad" | "hrv" | "overuseGuard" | "heatAcclimatization"
  | "fuelingAlerts" | "weeklyParentReport" | "calendarImport" | "familyLink";

interface Rule { min?: number; max?: number; female?: boolean; why: string }

const RULES: Record<FeatureId, Rule> = {
  sweatTest: { min: 15, why: "Weighing before and after training is for older players. Younger kids just drink at every break." },
  urineColor: { min: 10, why: "For young kids, parents watch drinking instead of a color chart." },
  sorenessMap: { why: "" },
  growth: { max: 18, why: "Growth tracking is for players who are still growing." },
  asthma: { why: "" },
  concussion: { why: "" },
  cycle: { min: 12, female: true, why: "Cycle tracking is opt-in for players 12 and up." },
  breathing: { why: "" },
  burnoutCheck: { min: 10, why: "Young kids get a simple fun check instead." },
  crisisLine: { min: 12, why: "" },
  warmup: { why: "" },
  schoolDay: { max: 18, why: "The school-day planner is for students." },
  travel: { why: "" },
  recipes: { why: "" },
  mealPlan: { why: "" },
  eatingOut: { why: "" },
  snapPlate: { min: 13, why: "Photo analysis is for players 13 and up." },
  appleHealth: { min: 13, why: "Health data from devices is for players 13 and up." },
  garmin: { min: 13, why: "Wearables are for players 13 and up." },
  whoop: { min: 18, why: "Whoop and Oura are adult devices. Their terms require adult users." },
  oura: { min: 18, why: "Whoop and Oura are adult devices. Their terms require adult users." },
  bodyWeight: { min: 18, why: "We don't show body weight to players under 18. Growing athletes should focus on fuel and energy, not the scale." },
  sessionLoad: { min: 13, why: "Training-load math is for players 13 and up." },
  hrv: { min: 16, why: "Heart-rate variability is for older players with a wearable." },
  overuseGuard: { max: 18, why: "Weekly hour limits are for growing athletes." },
  heatAcclimatization: { min: 13, why: "The 14-day preseason heat plan is for high school age and up." },
  fuelingAlerts: { max: 18, why: "Quiet fueling alerts go to parents of players under 19." },
  weeklyParentReport: { max: 17, why: "The weekly parent report is for players under 18." },
  calendarImport: { why: "" },
  familyLink: { why: "" },
};

export interface FeatureSet {
  age: number | null;
  on: Record<FeatureId, boolean>;
  /** Why a feature is off, for a short note on screen. */
  off: Partial<Record<FeatureId, string>>;
}

export function featuresFor(profile: AthleteProfile): FeatureSet {
  const age = effectiveAge(profile.identity);
  const a = age ?? 18; // no age: treat as an adult but still hide weight-free defaults below
  const on = {} as Record<FeatureId, boolean>;
  const off: FeatureSet["off"] = {};
  for (const [id, r] of Object.entries(RULES) as [FeatureId, Rule][]) {
    let ok = true;
    if (r.min !== undefined && a < r.min) ok = false;
    if (r.max !== undefined && a > r.max) ok = false;
    if (r.female && profile.identity.sex !== "female") ok = false;
    on[id] = ok;
    if (!ok && r.why && !(r.female && profile.identity.sex !== "female")) off[id] = r.why;
  }
  return { age: age ?? null, on, off };
}

export const allows = (profile: AthleteProfile, f: FeatureId) => featuresFor(profile).on[f];

/** The full table, for the "What's included at each age" screen. */
export function featureTable(): { id: FeatureId; ages: string }[] {
  return (Object.entries(RULES) as [FeatureId, Rule][]).map(([id, r]) => ({
    id,
    ages: r.min !== undefined && r.max !== undefined ? `${r.min}-${r.max}` : r.min !== undefined ? `${r.min}+` : r.max !== undefined ? `up to ${r.max}` : "all ages",
  }));
}
