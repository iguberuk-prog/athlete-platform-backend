/**
 * Match-day recommendation engine (pure, testable).
 *
 * Given an athlete profile (and optionally today's check-in), produce a
 * match-day plan: pre-game fueling, in-game carbs/hydration, and post-game
 * recovery — scaled to the athlete's body mass, with food suggestions filtered
 * against allergies, dietary restrictions, and intolerances.
 *
 * Targets are grounded in published sports-nutrition guidance (see the
 * architecture doc / README appendix). They are starting defaults; a qualified
 * professional should review plans for athletes with medical conditions.
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { to12 } from "./dates.js";

export interface PlanTarget {
  label: string;
  /** Human-readable target, usually with the athlete's personalized numbers. */
  detail: string;
}

export interface PlanBlock {
  phase: string;
  timing: string;
  targets: PlanTarget[];
  /** Example foods that respect the athlete's allergies/diet. */
  foods?: string[];
  notes?: string[];
}

export interface MatchDayPlan {
  profileId: string;
  date: string;
  kickoff: string;
  /** True when no real fixture was found and an evening kickoff was assumed. */
  assumedKickoff: boolean;
  conditions?: string;
  sport: string;
  bodyMassKg: number;
  summary: string;
  blocks: PlanBlock[];
  safety: {
    avoidAllergens: string[];
    diets: string[];
    intolerances: string[];
    medicalFlags: string[];
    warnings: string[];
  };
  disclaimer: string;
}

export interface PlanOptions {
  date: string; // YYYY-MM-DD
  kickoff: string; // HH:MM
  assumedKickoff: boolean;
  conditions?: string;
  checkin?: DailyCheckIn | null;
}

// --- food list with allergen/diet tags ------------------------------------

/** Allergen/diet tags a food carries. Shared by the plan, timeline and grocery list. */
export interface FoodTags {
  allergens?: string[]; // maps to ALLERGENS values
  animal?: boolean; // excluded for vegan
  meat?: boolean; // excluded for vegetarian/pescatarian
  fishOnly?: boolean; // a fish/seafood protein
  lactose?: boolean;
  gluten?: boolean;
}

interface Food extends FoodTags {
  name: string;
  kind: "carb" | "protein";
}

const FOODS: Food[] = [
  { name: "white rice", kind: "carb" },
  { name: "potato", kind: "carb" },
  { name: "banana", kind: "carb" },
  { name: "honey", kind: "carb" },
  { name: "oats", kind: "carb" },
  { name: "sports drink", kind: "carb" },
  { name: "energy gel", kind: "carb" },
  { name: "pasta", kind: "carb", allergens: ["wheat", "gluten"], gluten: true },
  { name: "wholegrain bread", kind: "carb", allergens: ["wheat", "gluten"], gluten: true },
  { name: "chicken breast", kind: "protein", animal: true, meat: true },
  { name: "lean beef", kind: "protein", animal: true, meat: true },
  { name: "salmon", kind: "protein", animal: true, fishOnly: true, allergens: ["fish"] },
  { name: "eggs", kind: "protein", animal: true, allergens: ["egg"] },
  { name: "Greek yogurt", kind: "protein", animal: true, allergens: ["milk"], lactose: true },
  { name: "whey shake", kind: "protein", animal: true, allergens: ["milk"] },
  { name: "tofu", kind: "protein", allergens: ["soy"] },
  { name: "lentils", kind: "protein" },
  { name: "almonds", kind: "protein", allergens: ["tree_nut"] },
];

/** True when a food is safe for the given allergies, diets and intolerances. */
export function foodAllowed(
  f: FoodTags,
  allergens: string[],
  diets: string[],
  intolerances: string[],
): boolean {
  const vegan = diets.includes("vegan");
  const vegetarian = diets.includes("vegetarian") || vegan;
  const pescatarian = diets.includes("pescatarian");
  const dairyFree = diets.includes("dairy_free");
  const glutenFree = diets.includes("gluten_free");
  const nutFree = diets.includes("nut_free");
  const noLactose = intolerances.includes("lactose");
  const noGluten = glutenFree || intolerances.includes("gluten");
  const tags = f.allergens || [];
  if (tags.some((a) => allergens.includes(a))) return false;
  if (vegan && f.animal) return false;
  if (vegetarian && f.meat) return false; // vegetarians: no meat (eggs/dairy ok)
  if (pescatarian && f.meat) return false; // pescatarians: no meat, fish ok
  if ((dairyFree || noLactose) && (f.lactose || tags.includes("milk") && dairyFree)) return false;
  if (noGluten && f.gluten) return false;
  if (nutFree && tags.some((a) => a === "tree_nut" || a === "peanut")) return false;
  return true;
}

/** Profile-level wrapper around foodAllowed. */
export function foodAllowedFor(profile: AthleteProfile, f: FoodTags): boolean {
  const n = profile.nutrition;
  return foodAllowed(
    f,
    (n.allergies || []).map((a) => a.allergen),
    n.dietaryRestrictions || [],
    n.intolerances || [],
  );
}

function safeFoods(
  kind: "carb" | "protein",
  allergens: string[],
  diets: string[],
  intolerances: string[],
): string[] {
  return FOODS.filter((f) => f.kind === kind)
    .filter((f) => foodAllowed(f, allergens, diets, intolerances))
    .map((f) => f.name);
}

const r = (n: number) => Math.round(n);
const range = (lo: number, hi: number, unit: string) => `${r(lo)}–${r(hi)} ${unit}`;

/** Build a match-day plan for the given profile and options. Pure function. */
export function buildMatchDayPlan(profile: AthleteProfile, opts: PlanOptions): MatchDayPlan {
  const M = profile.anthropometrics.bodyMassKg;
  const n = profile.nutrition;
  const allergens = (n.allergies || []).map((a) => a.allergen);
  const diets = n.dietaryRestrictions || [];
  const intolerances = n.intolerances || [];
  const carbFoods = safeFoods("carb", allergens, diets, intolerances);
  const proteinFoods = safeFoods("protein", allergens, diets, intolerances);

  // Hydration: use measured sweat rate if available, else a sensible default.
  const sweat = profile.advanced?.sweatRateLitresPerHour;
  const fluidDetail = sweat
    ? `~${sweat.toFixed(1)} L/hour (from your measured sweat rate), sipped across each half`
    : "drink to thirst, roughly 0.4–0.8 L per half; more in heat";

  const blocks: PlanBlock[] = [
    {
      phase: "Day before",
      timing: "Throughout the day before the match",
      targets: [
        { label: "Carbohydrate", detail: `${range(6 * M, 8 * M, "g")} over the day (6–8 g/kg) to top up glycogen` },
        { label: "Fluids", detail: "Stay well hydrated; pale-yellow urine is the target" },
      ],
      foods: carbFoods.slice(0, 5),
    },
    {
      phase: "Pre-match meal",
      timing: `3–4 hours before kickoff (${to12(opts.kickoff)})`,
      targets: [
        { label: "Carbohydrate", detail: `${range(1 * M, 3 * M, "g")} (1–3 g/kg) in the meal` },
        { label: "Keep it familiar", detail: "Lower fat/fibre to avoid GI discomfort" },
      ],
      foods: carbFoods.slice(0, 4),
    },
    {
      phase: "During the match",
      timing: "Across both halves + at half-time",
      targets: [
        { label: "Carbohydrate", detail: "30–60 g per hour (sports drink and/or a gel at half-time)" },
        { label: "Fluids", detail: fluidDetail },
        { label: "Sodium", detail: "~0.5–0.7 g sodium per litre of fluid to replace sweat losses" },
      ],
      foods: carbFoods.filter((f) => ["sports drink", "energy gel", "banana", "honey"].includes(f)),
    },
    {
      phase: "Immediately after (first 20 min)",
      timing: "Start within ~20 minutes of the final whistle",
      targets: [
        { label: "Carbohydrate", detail: `~${r(1.2 * M)} g (1.2 g/kg) to restart glycogen` },
        { label: "Protein", detail: "~40 g to support muscle repair" },
        { label: "Rehydrate", detail: "~150% of the body mass lost in fluid, with electrolytes" },
      ],
      foods: proteinFoods.slice(0, 4),
    },
    {
      phase: "Recovery (next 1–2 days)",
      timing: "Especially important before the next fixture",
      targets: [
        { label: "Carbohydrate", detail: `${range(6 * M, 10 * M, "g")} per day (6–10 g/kg)` },
        { label: "Protein", detail: `>${r(1.5 * M)} g per day (>1.5 g/kg), spread across meals` },
        { label: "Sleep", detail: "Prioritise 8–9 hours; it is the strongest recovery lever" },
      ],
      foods: proteinFoods.slice(0, 4),
    },
  ];

  // Readiness flag from today's check-in.
  const warnings: string[] = [];
  const ci = opts.checkin;
  if (ci) {
    if ((ci.sorenessLevel ?? 0) >= 7) warnings.push("High soreness reported today — emphasise warm-up, mobility, and post-match recovery.");
    if ((ci.energyLevel ?? 10) <= 4) warnings.push("Low energy reported — make sure the pre-match carbohydrate target is met.");
    if ((ci.sleepHoursLastNight ?? 8) < 6) warnings.push("Short sleep last night — hydration and carbohydrate timing matter more today.");
  }
  if ((profile.health?.currentInjuries || []).length > 0) {
    warnings.push("Current injury on file — follow medical guidance; this plan is nutrition only.");
  }

  const medicalFlags = [
    ...(profile.health?.medicalConditions || []),
    ...(profile.health?.recentIllnessStatus && profile.health.recentIllnessStatus !== "healthy"
      ? [`recent illness: ${profile.health.recentIllnessStatus}`]
      : []),
  ];

  return {
    profileId: profile.id,
    date: opts.date,
    kickoff: opts.kickoff,
    assumedKickoff: opts.assumedKickoff,
    conditions: opts.conditions,
    sport: profile.sport.primarySport,
    bodyMassKg: M,
    summary: `Match-day fueling plan for ${profile.identity.fullName} (${M} kg) on ${opts.date}` +
      (opts.assumedKickoff ? " — assuming an evening kickoff; add your fixture to personalize timing." : `, kickoff ${to12(opts.kickoff)}.`),
    blocks,
    safety: {
      avoidAllergens: allergens,
      diets,
      intolerances,
      medicalFlags,
      warnings,
    },
    disclaimer:
      "Starting targets from published sports-nutrition guidance; not a substitute for individualized professional advice.",
  };
}

/** Body-mass-aware safe food suggestions for a profile (reused by the timeline). */
export function safeFoodSuggestions(
  profile: AthleteProfile,
  kind: "carb" | "protein",
): string[] {
  const n = profile.nutrition;
  return safeFoods(
    kind,
    (n.allergies || []).map((a) => a.allergen),
    n.dietaryRestrictions || [],
    n.intolerances || [],
  );
}
