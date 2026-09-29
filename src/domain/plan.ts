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
import { bandForAge } from "./ageBands.js";
import { effectiveAge } from "./profile.js";
import { examples, names, pick, safeFor, safetyContext, unsafeReason, type FoodTags, type SafetyContext } from "./foods.js";

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

// --- food safety (delegates to the central catalog in foods.ts) -----------

export type { FoodTags };

/** Profile-level safety check for an ad-hoc food (used by the grocery list and tests). */
export function foodAllowedFor(profile: AthleteProfile, f: FoodTags & { name?: string }): boolean {
  return unsafeReason(f as never, safetyContext(profile)) === null;
}

/** Safe food names for broad kinds (kept for callers of the original API). */
export function safeFoodSuggestions(profile: AthleteProfile, kind: "carb" | "protein", ctx?: SafetyContext): string[] {
  const c = ctx || safetyContext(profile);
  return kind === "carb"
    ? names([...safeFor(c, "meal_carb"), ...safeFor(c, "quick_carb")]).filter((v, i, a) => a.indexOf(v) === i)
    : names([...safeFor(c, "protein"), ...safeFor(c, "slow_protein")]).filter((v, i, a) => a.indexOf(v) === i);
}

const r = (n: number) => Math.round(n);
const range = (lo: number, hi: number, unit: string) => `${r(lo)}–${r(hi)} ${unit}`;

/** Build a match-day plan for the given profile and options. Pure function. */
export function buildMatchDayPlan(profile: AthleteProfile, opts: PlanOptions): MatchDayPlan {
  const M = profile.anthropometrics.bodyMassKg;
  const n = profile.nutrition;
  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const c = safetyContext(profile, { gameDay: true });
  const young = band.inGame === "water_fruit";
  const P = band.proteinPerKg;

  const sweat = profile.advanced?.sweatRateLitresPerHour;
  const fluidDetail = sweat
    ? `~${sweat.toFixed(1)} L/hour (from your measured sweat rate), sipped across each half`
    : young
      ? "water at every break and at half-time; more in heat"
      : "drink to thirst, roughly 0.4–0.8 L per half; more in heat";

  const inGameFoods = names(pick(c, young ? ["water", "orange", "banana", "grapes", "sports_drink"] : ["sports_drink", "gel", "chews", "banana", "orange"], 4, "halftime"));

  const blocks: PlanBlock[] = [
    {
      phase: "Day before",
      timing: "Throughout the day before the match",
      targets: young
        ? [{ label: "Meals", detail: `Normal meals with a bigger serving of carbs at dinner (${examples(safetyContext(profile), ["rice", "pasta", "gf_pasta", "potato"], 3, "meal_carb")})` }, { label: "Fluids", detail: "Water with every meal" }]
        : [
            { label: "Carbohydrate", detail: `${range(6 * M, 8 * M, "g")} over the day (6–8 g/kg) to top up glycogen` },
            { label: "Fluids", detail: "Stay well hydrated; pale-yellow urine is the target" },
          ],
      foods: names(pick(c, ["rice", "pasta", "gf_pasta", "potato", "bagel", "sweet_potato"], 5, "meal_carb")),
    },
    {
      phase: "Pre-match meal",
      timing: `3–4 hours before kickoff (${to12(opts.kickoff)})`,
      targets: young
        ? [{ label: "Plate", detail: "Half the plate carbs, a small portion of protein, low fat" }, { label: "Keep it familiar", detail: "Foods they eat often" }]
        : [
            { label: "Carbohydrate", detail: `${range(1 * M, 3 * M, "g")} (1–3 g/kg) in the meal` },
            { label: "Keep it familiar", detail: "Lower fat/fibre to avoid GI discomfort" },
          ],
      foods: names(pick(c, ["rice", "pasta", "gf_pasta", "bagel", "potato", "toast", "gf_toast"], 4, "meal_carb")),
    },
    {
      phase: "During the match",
      timing: "Across both halves + at half-time",
      targets: young
        ? [
            { label: "Drink", detail: "Water. A sports drink only when it's hot or play runs over an hour" },
            { label: "Half-time", detail: `A quick snack: ${examples(c, ["orange", "banana", "grapes"], 2, "halftime")}` },
          ]
        : [
            { label: "Carbohydrate", detail: `30–60 g per hour: ${examples(c, ["sports_drink", "gel", "chews", "banana"], 3, "halftime")}` },
            { label: "Fluids", detail: fluidDetail },
            { label: "Sodium", detail: "~0.5–0.7 g sodium per litre of fluid to replace sweat losses" },
          ],
      foods: inGameFoods,
    },
    {
      phase: "Immediately after (first 20 min)",
      timing: "Start within ~20 minutes of the final whistle",
      targets: young
        ? [{ label: "Snack", detail: `Carbs plus protein: ${examples(c, ["choc_milk", "lf_milk", "soy_milk", "turkey_sandwich", "greek_yogurt", "banana"], 3, "recovery")}` }, { label: "Drink", detail: "Water until they're no longer thirsty" }]
        : [
            { label: "Carbohydrate", detail: `~${r(1.2 * M)} g (1.2 g/kg) to restart glycogen` },
            { label: "Protein", detail: `~${r(band.perMealProteinPerKg * M)} g to support muscle repair` },
            { label: "Rehydrate", detail: "~150% of the body mass lost in fluid, with electrolytes" },
          ],
      foods: names(pick(c, ["choc_milk", "greek_yogurt", "lf_yogurt", "whey", "plant_shake", "soy_milk", "turkey_sandwich", "rice_bowl", "tofu_bowl"], 4, "recovery")),
    },
    {
      phase: "Recovery (next 1–2 days)",
      timing: "Especially important before the next fixture",
      targets: [
        young
          ? { label: "Meals", detail: "Regular meals and snacks; carbs at every meal" }
          : { label: "Carbohydrate", detail: `${range(6 * M, 10 * M, "g")} per day (6–10 g/kg)` },
        { label: "Protein", detail: `${range(P[0] * M, P[1] * M, "g")} per day, spread across meals` },
        { label: "Sleep", detail: "Prioritise sleep; it is the strongest recovery lever" },
      ],
      foods: names(pick(c, ["chicken", "salmon", "eggs", "greek_yogurt", "tofu", "lentils", "turkey", "beef"], 4, "protein")),
    },
  ];

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
  if (c.medical.includes("type1_diabetes")) warnings.push("Type 1 diabetes: follow your diabetes care team's game-day plan for carbs and insulin.");
  if ((n.allergies || []).some((a) => a.epinephrine || a.anaphylaxis)) warnings.push("Pack the epinephrine auto-injector.");

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
      avoidAllergens: (n.allergies || []).map((a) => (a.allergen === "other" ? a.note || "other" : a.allergen)),
      diets: n.dietaryRestrictions || [],
      intolerances: n.intolerances || [],
      medicalFlags,
      warnings,
    },
    disclaimer:
      "Starting targets from published sports-nutrition guidance; not a substitute for individualized professional advice.",
  };
}
