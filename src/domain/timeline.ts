/**
 * Game-day timeline (pure, testable).
 *
 * Turns a player + an event (date, kickoff, wake time, bedtime, "plays
 * tomorrow?") into a clock-anchored schedule from wake-up to bedtime:
 *   wake -> morning prep -> pre-game meal -> kickoff -> halftime -> full time
 *   -> immediate recovery -> evening meal -> night routine -> bed.
 *
 * Every nutrition target is scaled to the athlete's body mass and every food
 * suggestion respects allergies/diet/intolerances. If the athlete plays again
 * tomorrow, the night routine emphasises next-day recovery and we expose a
 * "plays tomorrow" hook so the UI can offer to build tomorrow's plan.
 *
 * Targets follow published sports-nutrition guidance; they are starting
 * defaults, not individualized medical advice.
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { gameMorning, to12 } from "./dates.js";
import { bandForAge, parentVoice, sleepHoursFor } from "./ageBands.js";
import { effectiveAge } from "./profile.js";
import { examples, names, pick, safetyContext } from "./foods.js";
import { cups as cupText, type WeatherPlan } from "./weather.js";

export interface TimelineEntry {
  time: string; // HH:MM
  phase: string;
  title: string;
  detail: string;
  foods?: string[];
}

export interface DayBeforeItem {
  when: string;
  title: string;
  detail: string;
  foods?: string[];
}

export interface DayBeforeSection {
  date: string; // YYYY-MM-DD (the evening before the match)
  title: string;
  items: DayBeforeItem[];
}

export interface CalendarEvent {
  title: string;
  /** ISO-8601 local datetime, e.g. 2026-06-10T19:00. */
  start: string;
  durationMin: number;
  description: string;
}

export interface GameDayTimeline {
  profileId: string;
  date: string;
  sport: string;
  bodyMassKg: number;
  kickoff: string;
  wakeTime: string;
  bedTime: string;
  playsTomorrow: boolean;
  dayBefore: DayBeforeSection;
  entries: TimelineEntry[];
  nightRoutine: { title: string; items: string[] };
  nextDay: { playsTomorrow: boolean; note: string };
  calendar: CalendarEvent[];
  safety: { avoidAllergens: string[]; diets: string[]; intolerances: string[]; warnings: string[] };
  /** Forecast-driven changes for this game (null without a ZIP or forecast). */
  weather: WeatherPlan | null;
  disclaimer: string;
}

export interface TimelineOptions {
  date: string; // YYYY-MM-DD
  kickoff: string; // HH:MM
  wakeTime?: string; // HH:MM
  bedTime?: string; // HH:MM
  conditions?: string;
  playsTomorrow?: boolean;
  checkin?: DailyCheckIn | null;
  weather?: WeatherPlan | null;
}

// --- clock helpers ---------------------------------------------------------

const toMin = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMin = (min: number): string => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const r = (n: number) => Math.round(n);
const range = (lo: number, hi: number, unit: string) => `${r(lo)}–${r(hi)} ${unit}`;
/** Round a minutes-of-day value to the nearest 15-minute increment. */
const snap15 = (min: number): number => Math.round(min / 15) * 15;
/** The calendar date the day before `date` (YYYY-MM-DD), TZ-safe via UTC noon. */
const prevDate = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Build a full game-day timeline for the profile. Pure function. */
export function buildGameDayTimeline(
  profile: AthleteProfile,
  opts: TimelineOptions,
): GameDayTimeline {
  const M = profile.anthropometrics.bodyMassKg;
  const morning = gameMorning(opts.kickoff, opts.wakeTime || "07:00");
  const wake = morning.wake;
  const bed = opts.bedTime || "22:30";
  const kickMin = toMin(opts.kickoff);
  const playsTomorrow = !!opts.playsTomorrow;
  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const young = band.inGame === "water_fruit";
  const kid = parentVoice(age);
  const [sleepLo, sleepHi] = sleepHoursFor(age);
  const c = safetyContext(profile, { gameDay: true });
  const cEve = safetyContext(profile);
  const ex = (ids: string[], n = 3, role?: Parameters<typeof pick>[3]) => examples(c, ids, n, role);
  const list = (ids: string[], n = 4, role?: Parameters<typeof pick>[3]) => names(pick(c, ids, n, role));
  const MEAL = ["rice", "pasta", "gf_pasta", "potato", "bagel", "toast", "gf_toast", "sweet_potato"];
  const BREAKFAST = ["oats", "toast", "gf_toast", "bagel", "banana", "berries", "greek_yogurt", "eggs"];
  const QUICK = ["banana", "toast", "gf_toast", "rice_cakes", "applesauce", "honey", "jam", "sports_drink"];
  const RECOVER = ["choc_milk", "greek_yogurt", "lf_yogurt", "whey", "plant_shake", "soy_milk", "turkey_sandwich", "rice_bowl", "tofu_bowl"];
  const PROTEIN = ["chicken", "salmon", "turkey", "eggs", "tofu", "beef", "lentils"];
  const SLOW = ["greek_yogurt", "cottage", "lf_yogurt", "milk", "lf_milk", "soy_milk"];

  const sweat = profile.advanced?.sweatRateLitresPerHour;
  const inGameFluids = sweat
    ? `~${sweat.toFixed(1)} L/hour across each half`
    : "sip to thirst, ~0.4–0.8 L per half (more in heat)";

  // Soccer defaults: 90-min play + 15-min half ≈ kickoff to full time +110 min.
  const halftimeMin = kickMin + 50;
  const fulltimeMin = kickMin + 110;

  const entries: TimelineEntry[] = [
    {
      time: wake,
      phase: "Wake-up",
      title: "Hydrate & light breakfast",
      detail: morning.earlyAlarm
        ? `Early kickoff: set your alarm for ${to12(wake)}. Drink ~500 ml water on waking.`
        : morning.lighter
          ? "~500 ml water on waking. Your main meal comes soon, so keep this to a drink or a bite."
          : "~500 ml water on waking; an easy carbohydrate breakfast to start topping up energy.",
      foods: list(BREAKFAST, 3, "breakfast"),
    },
    {
      time: morning.preMeal,
      phase: "Pre-game meal",
      title: morning.lighter
        ? morning.gapMin <= 120 ? "Small, easy pre-game meal (early kickoff)" : "Lighter fueling meal (2.5–3 h before kickoff)"
        : "Main fueling meal (3–4 h before kickoff)",
      detail: morning.lighter
        ? morning.gapMin <= 120
          ? `${young ? "A small, easy meal" : `About ${r(1 * M)} g easy carbohydrate (1 g/kg)`}: ${ex(QUICK, 3, "quick_carb")}. Almost no fat or fibre. Sip ${young ? "water" : "fluids"}.`
          : `${young ? "A lighter, easy meal" : `${range(1 * M, 2 * M, "g")} carbohydrate (1–2 g/kg), easy to digest`}: ${ex(MEAL, 3, "meal_carb")}. Keep fat and fibre very low.`
        : young
          ? `A normal-size meal, half the plate carbs: ${ex(MEAL, 3, "meal_carb")}. Keep fat and fibre low.`
          : `${range(1 * M, 3 * M, "g")} carbohydrate (1–3 g/kg): ${ex(MEAL, 3, "meal_carb")}. Keep fat/fibre low to avoid GI upset.`,
      foods: list(MEAL, 4, "meal_carb"),
    },
    {
      time: fromMin(snap15(kickMin - 60)),
      phase: "Pre-game top-up",
      title: "Light top-up + hydrate",
      detail: `Small, fast carbohydrate snack: ${ex(["banana", "rice_cakes", "applesauce", "toast", "gf_toast"], 2, "quick_carb")}, plus ${young ? "water" : "fluids"}. Warm up ${band.warmupMin} minutes.`,
      foods: list(["banana", "rice_cakes", "applesauce", "toast", "gf_toast"], 3, "quick_carb"),
    },
    {
      time: opts.kickoff,
      phase: "Kickoff",
      title: "Start in-game fueling",
      detail: young
        ? "Water at every break. A sports drink only if it's hot or play runs over an hour."
        : `30–60 g carbohydrate per hour; ${inGameFluids}; ~0.5–0.7 g sodium per litre of fluid.`,
      foods: young ? list(["water"], 1) : list(["sports_drink", "gel", "chews"], 3, "in_game"),
    },
    {
      time: fromMin(snap15(halftimeMin)),
      phase: "Half-time",
      title: "Mid-game energy",
      detail: young
        ? `Water and a quick snack: ${ex(["orange", "banana", "grapes"], 2, "halftime")}.`
        : `Quick carbs to keep energy up for the second half: ${ex(["sports_drink", "gel", "chews", "banana", "orange"], 2, "halftime")}. Plus fluids.`,
      foods: list(young ? ["orange", "banana", "grapes"] : ["sports_drink", "gel", "chews", "banana"], 3, "halftime"),
    },
    {
      time: fromMin(snap15(fulltimeMin)),
      phase: "Full time",
      title: "Cool down",
      detail: "Light cool-down and start rehydrating immediately.",
    },
    {
      time: fromMin(snap15(fulltimeMin + 20)),
      phase: "Immediate recovery",
      title: "Recovery feeding (first ~20 min)",
      detail: young
        ? `A snack with carbs and protein: ${ex(RECOVER, 2, "recovery")}. Water until no longer thirsty.`
        : `~${r(1.2 * M)} g carbohydrate (1.2 g/kg) + ~${r(band.perMealProteinPerKg * M)} g protein: ${ex(RECOVER, 2, "recovery")}. Rehydrate ~150% of fluid lost, with electrolytes.`,
      foods: list(RECOVER, 4, "recovery"),
    },
    {
      time: fromMin(snap15(fulltimeMin + 120)),
      phase: "Evening meal",
      title: "Balanced recovery dinner",
      detail: "A full meal with carbohydrate + protein + vegetables to continue refuelling.",
      foods: [...list(MEAL, 2, "meal_carb"), ...list(PROTEIN, 2, "protein")],
    },
  ];

  // Weather: layer the forecast onto the day.
  const wp = opts.weather || null;
  if (wp && wp.severity !== "none") {
    const hot = !!wp.conditions.heat && wp.conditions.heat !== "green";

    if (hot) {
      entries.push({
        time: fromMin(Math.max(toMin(wake), snap15(kickMin - 240))),
        phase: "Pre-hydrate",
        title: `Heat plan: drink ${wp.preHydrateMl} ml now`,
        detail: `About ${cupText(wp.preHydrateMl)} over the next 30 minutes${young ? "" : ", with some salt or a sports drink"}. Pale-yellow urine by warm-up is the goal.`,
      });
      entries.push({
        time: fromMin(snap15(kickMin - 30)),
        phase: "Pre-cool",
        title: "Cool down before warming up",
        detail: `Something ice-cold: ${examples(c, ["slushie", "freeze_pops", "cold_grapes", "watermelon"], 2, "cooling")}. Stay in the shade until warm-up.`,
        foods: names(pick(c, ["slushie", "freeze_pops", "cold_grapes", "watermelon"], 3, "cooling")),
      });
    } else if (wp.foodRole === "warm") {
      entries.push({
        time: fromMin(snap15(kickMin - 45)),
        phase: "Warm-up",
        title: `Longer warm-up (${band.warmupMin + (wp.severity === "high" ? 10 : 5)} min)`,
        detail: "Keep your warm layers on until kickoff. Cold muscles strain more easily.",
      });
    }
    for (const e of entries) {
      if (e.phase === "Kickoff") {
        e.detail = hot
          ? `${young ? "Drink at every break" : "30–60 g carbohydrate per hour"}; aim for ${wp.inGameLph[0]}–${wp.inGameLph[1]} L of fluid per hour${young ? "" : " with electrolytes"}. Take every water break.`
          : `${e.detail} Keep drinking even though you won't feel thirsty in the cold.`;
      }
      if (e.phase === "Half-time") {
        e.detail = hot
          ? `Shade, cold towels, and fluids with electrolytes. ${examples(c, ["cold_grapes", "orange", "watermelon", "sports_drink"], 2, "halftime")}.`
          : `Layer up. A warm drink from the thermos (${examples(c, ["broth", "herbal_tea", "hot_cocoa"], 2, "warm")}) and ${examples(c, ["banana", "orange", "sports_drink"], 1, "halftime")}.`;
        e.foods = hot ? names(pick(c, ["cold_grapes", "orange", "watermelon", "sports_drink"], 3, "halftime")) : names(pick(c, ["broth", "herbal_tea", "hot_cocoa"], 3, "warm"));
      }
      if (e.phase === "Immediate recovery") {
        e.detail = hot
          ? `${e.detail} Heat day: cool down in the shade first, and drink about 1.5 times what you sweated out.`
          : `Dry, warm clothes within 10 minutes. ${e.detail} Something warm: ${examples(c, ["hot_cocoa", "chicken_soup", "broth", "warm_rice_bowl"], 2, "warm")}.`;
      }
    }
    entries.sort((a, b) => a.time.localeCompare(b.time));
  }

  // Night routine.
  const nightItems: string[] = [
    "Wind down: dim screens, keep the room cool and dark.",
    `Aim for ${sleepLo}–${sleepHi} hours of sleep — the single biggest recovery lever.`,
  ];
  if (playsTomorrow) {
    nightItems.unshift(
      young
        ? `${kid ? "They play" : "You play"} again tomorrow: a good dinner with extra carbs, plenty of water, and an early bedtime.`
        : `You play again tomorrow — keep refuelling tonight (target 6–10 g/kg carbohydrate across today) and hydrate well.`,
      `A protein snack before bed (e.g. ${examples(cEve, SLOW, 2, "slow_protein", "a protein snack you tolerate")}) supports overnight repair.`,
    );
  } else {
    nightItems.push("No game tomorrow: a normal balanced evening is fine; prioritise sleep.");
  }
  entries.push({
    time: fromMin(snap15(toMin(bed) - 45)),
    phase: "Night routine",
    title: playsTomorrow ? "Night recovery (game tomorrow)" : "Wind down",
    detail: playsTomorrow
      ? "Tonight sets up tomorrow's performance: top up carbs, hydrate, slow protein, and protect sleep."
      : "Relax and recover; let your body rebuild overnight.",
    foods: playsTomorrow ? names(pick(cEve, SLOW, 3, "slow_protein")) : undefined,
  });
  entries.push({ time: bed, phase: "Bed", title: "Lights out", detail: "Target a consistent bedtime for full recovery." });

  // Readiness warnings from today's check-in.
  const warnings: string[] = [];
  const ci = opts.checkin;
  if (ci) {
    if ((ci.sorenessLevel ?? 0) >= 7) warnings.push("High soreness today — extend warm-up and post-game recovery.");
    if ((ci.sleepHoursLastNight ?? 8) < 6) warnings.push("Short sleep last night — hydration and carb timing matter more today.");
    if ((ci.energyLevel ?? 10) <= 4) warnings.push("Low energy — make sure the pre-game carbohydrate target is met.");
  }

  // Day before the match: evening & night prep (its own section).
  const slowProtein = examples(cEve, SLOW, 1, "slow_protein", "a protein snack you tolerate");
  const dayBefore: DayBeforeSection = {
    date: prevDate(opts.date),
    title: "Day before — evening & night prep",
    items: [
      {
        when: "Evening meal",
        title: "Carb-focused dinner",
        detail: young
          ? `A normal dinner with a bigger serving of carbs (${examples(cEve, MEAL, 3, "meal_carb")}), some protein and vegetables.`
          : `Make carbohydrate the centre of the plate (aim ${range(6 * M, 8 * M, "g")} across the day, 6–8 g/kg) with lean protein and vegetables; keep heavy fat and fibre moderate so you wake up light.`,
        foods: [...names(pick(cEve, MEAL, 2, "meal_carb")), ...names(pick(cEve, PROTEIN, 2, "protein"))],
      },
      {
        when: "Through the evening",
        title: "Hydrate steadily",
        detail: "Sip fluids through the evening so you start match day fully hydrated — pale-yellow urine is the target. Add a pinch of electrolytes if it has been hot or you trained hard.",
      },
      {
        when: "Before bed",
        title: "Slow protein + wind-down",
        detail: `A slow-digesting protein before bed (${slowProtein}) supports overnight repair. Dim screens, keep the room cool and dark, and set tomorrow's kit out so the morning is calm.`,
        foods: names(pick(cEve, SLOW, 1, "slow_protein")),
      },
      {
        when: "Sleep",
        title: `Protect ${sleepLo}–${sleepHi} hours`,
        detail: "Sleep is the single biggest recovery lever. Aim for a consistent bedtime the night before a match — earlier is better than later.",
      },
    ],
  };

  const n = profile.nutrition;
  const calendar: CalendarEvent[] = [
    { title: `${profile.identity.fullName} — Match`, start: `${opts.date}T${opts.kickoff}`, durationMin: 110, description: "Match-day fueling plan in the app." },
    { title: "Pre-game meal", start: `${opts.date}T${morning.preMeal}`, durationMin: 45, description: `${range(1 * M, 3 * M, "g")} carbohydrate.` },
    { title: "Recovery feeding", start: `${opts.date}T${fromMin(snap15(fulltimeMin + 20))}`, durationMin: 30, description: young ? "Carbs + protein snack and water." : `~${r(1.2 * M)} g carbs + ${r(band.perMealProteinPerKg * M)} g protein.` },
    { title: "Night-before carb dinner", start: `${dayBefore.date}T18:30`, durationMin: 60, description: `Carb-focused dinner to top up glycogen before match day (aim ${range(6 * M, 8 * M, "g")} carbohydrate across the day).` },
  ];

  return {
    profileId: profile.id,
    date: opts.date,
    sport: profile.sport.primarySport,
    bodyMassKg: M,
    kickoff: opts.kickoff,
    wakeTime: wake,
    bedTime: bed,
    playsTomorrow,
    dayBefore,
    entries,
    nightRoutine: { title: playsTomorrow ? "Night recovery routine (game tomorrow)" : "Night wind-down", items: nightItems },
    nextDay: {
      playsTomorrow,
      note: playsTomorrow
        ? "Tomorrow is a game day — open tomorrow's plan in the morning for its full timeline."
        : "No game scheduled tomorrow.",
    },
    calendar,
    safety: {
      avoidAllergens: (n.allergies || []).map((a) => (a.allergen === "other" ? a.note || "other" : a.allergen)),
      diets: n.dietaryRestrictions || [],
      intolerances: n.intolerances || [],
      warnings,
    },
    weather: wp,
    disclaimer: "Starting targets from published sports-nutrition guidance; not a substitute for individualized professional advice.",
  };
}
