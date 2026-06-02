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
import { safeFoodSuggestions } from "./plan.js";

export interface TimelineEntry {
  time: string; // HH:MM
  phase: string;
  title: string;
  detail: string;
  foods?: string[];
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
  entries: TimelineEntry[];
  nightRoutine: { title: string; items: string[] };
  nextDay: { playsTomorrow: boolean; note: string };
  calendar: CalendarEvent[];
  safety: { avoidAllergens: string[]; diets: string[]; intolerances: string[]; warnings: string[] };
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

/** Build a full game-day timeline for the profile. Pure function. */
export function buildGameDayTimeline(
  profile: AthleteProfile,
  opts: TimelineOptions,
): GameDayTimeline {
  const M = profile.anthropometrics.bodyMassKg;
  const wake = opts.wakeTime || "07:00";
  const bed = opts.bedTime || "22:30";
  const kickMin = toMin(opts.kickoff);
  const carbs = safeFoodSuggestions(profile, "carb");
  const protein = safeFoodSuggestions(profile, "protein");
  const playsTomorrow = !!opts.playsTomorrow;

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
      detail: "~500 ml water on waking; an easy carbohydrate breakfast to start topping up energy.",
      foods: carbs.slice(0, 3),
    },
    {
      time: fromMin(kickMin - 210),
      phase: "Pre-game meal",
      title: "Main fueling meal (3–4 h before kickoff)",
      detail: `${range(1 * M, 3 * M, "g")} carbohydrate (1–3 g/kg); keep fat/fibre low to avoid GI upset.`,
      foods: carbs.slice(0, 4),
    },
    {
      time: fromMin(kickMin - 60),
      phase: "Pre-game top-up",
      title: "Light top-up + hydrate",
      detail: "Small, fast carbohydrate snack and fluids; finish a warm-up plan.",
      foods: carbs.filter((f) => ["banana", "honey", "sports drink", "energy gel"].includes(f)),
    },
    {
      time: opts.kickoff,
      phase: "Kickoff",
      title: "Start in-game fueling",
      detail: `30–60 g carbohydrate per hour; ${inGameFluids}; ~0.5–0.7 g sodium per litre of fluid.`,
      foods: carbs.filter((f) => ["sports drink", "energy gel", "banana"].includes(f)),
    },
    {
      time: fromMin(halftimeMin),
      phase: "Half-time",
      title: "Mid-game energy",
      detail: "Take a gel and/or sports drink and fluids to keep blood glucose up for the second half.",
      foods: carbs.filter((f) => ["energy gel", "sports drink", "honey"].includes(f)),
    },
    {
      time: fromMin(fulltimeMin),
      phase: "Full time",
      title: "Cool down",
      detail: "Light cool-down and start rehydrating immediately.",
    },
    {
      time: fromMin(fulltimeMin + 20),
      phase: "Immediate recovery",
      title: "Recovery feeding (first ~20 min)",
      detail: `~${r(1.2 * M)} g carbohydrate (1.2 g/kg) + ~40 g protein; rehydrate ~150% of fluid lost, with electrolytes.`,
      foods: protein.slice(0, 4),
    },
    {
      time: fromMin(fulltimeMin + 120),
      phase: "Evening meal",
      title: "Balanced recovery dinner",
      detail: "A full meal with carbohydrate + protein + vegetables to continue refuelling.",
      foods: [...carbs.slice(0, 2), ...protein.slice(0, 2)],
    },
  ];

  // Night routine.
  const nightItems: string[] = [
    "Wind down: dim screens, keep the room cool and dark.",
    "Aim for 8–9 hours of sleep — the single biggest recovery lever.",
  ];
  if (playsTomorrow) {
    nightItems.unshift(
      `You play again tomorrow — keep refuelling tonight (target 6–10 g/kg carbohydrate across today) and hydrate well.`,
      `A slow-digesting protein before bed (e.g. ${protein.find((f) => /yogurt|casein|cottage|milk/i.test(f)) || protein[0] || "a protein snack"}) supports overnight repair.`,
    );
  } else {
    nightItems.push("No game tomorrow: a normal balanced evening is fine; prioritise sleep.");
  }
  entries.push({
    time: fromMin(toMin(bed) - 45),
    phase: "Night routine",
    title: playsTomorrow ? "Night recovery (game tomorrow)" : "Wind down",
    detail: playsTomorrow
      ? "Tonight sets up tomorrow's performance: top up carbs, hydrate, slow protein, and protect sleep."
      : "Relax and recover; let your body rebuild overnight.",
    foods: playsTomorrow ? protein.slice(0, 3) : undefined,
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

  const n = profile.nutrition;
  const calendar: CalendarEvent[] = [
    { title: `${profile.identity.fullName} — Match`, start: `${opts.date}T${opts.kickoff}`, durationMin: 110, description: "Match-day fueling plan in the app." },
    { title: "Pre-game meal", start: `${opts.date}T${fromMin(kickMin - 210)}`, durationMin: 45, description: `${range(1 * M, 3 * M, "g")} carbohydrate.` },
    { title: "Recovery feeding", start: `${opts.date}T${fromMin(fulltimeMin + 20)}`, durationMin: 30, description: `~${r(1.2 * M)} g carbs + 40 g protein.` },
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
      avoidAllergens: (n.allergies || []).map((a) => a.allergen),
      diets: n.dietaryRestrictions || [],
      intolerances: n.intolerances || [],
      warnings,
    },
    disclaimer: "Starting targets from published sports-nutrition guidance; not a substitute for individualized professional advice.",
  };
}
