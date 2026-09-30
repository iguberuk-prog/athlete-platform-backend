/**
 * Post-game journal, stats log, "what worked" insights and the season review (pure).
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { effectiveAge } from "./profile.js";
import { sleepHoursFor } from "./ageBands.js";

export const PRE_GAME_MEALS = ["carb_meal", "light_snack", "fast_food", "skipped", "other"] as const;
export type PreGameMeal = (typeof PRE_GAME_MEALS)[number];

export interface GameLog {
  id: string;
  date: string;
  type: "match" | "training" | "tournament";
  opponent?: string;
  minutes?: number;
  started?: boolean;
  position?: string;
  goals?: number;
  assists?: number;
  shots?: number;
  saves?: number;
  cleanSheet?: boolean;
  /** How it went, 1 (rough) to 5 (great). The player's own rating. */
  rating?: number;
  wentWell?: string;
  workOn?: string;
  preGameMeal?: PreGameMeal;
  result?: "win" | "draw" | "loss";
  notes?: string;
  createdAt?: string;
}

export type GameLogInput = Omit<GameLog, "id" | "createdAt">;

const isInt = (v: unknown, lo: number, hi: number) => v === undefined || (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi);
const isText = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

export function validateGameLog(x: GameLogInput): string[] {
  const e: string[] = [];
  if (!x || typeof x !== "object") return ["Body must be an object."];
  if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) e.push("date must be YYYY-MM-DD");
  if (!["match", "training", "tournament"].includes(x.type)) e.push("type must be match, training or tournament");
  if (!isInt(x.minutes, 0, 200)) e.push("minutes must be 0-200");
  for (const k of ["goals", "assists", "shots", "saves"] as const) if (!isInt(x[k], 0, 50)) e.push(`${k} must be 0-50`);
  if (!isInt(x.rating, 1, 5)) e.push("rating must be 1-5");
  for (const k of ["opponent", "position"] as const) if (!isText(x[k], 80)) e.push(`${k} is too long`);
  for (const k of ["wentWell", "workOn", "notes"] as const) if (!isText(x[k], 500)) e.push(`${k} must be under 500 characters`);
  if (x.preGameMeal !== undefined && !PRE_GAME_MEALS.includes(x.preGameMeal)) e.push("preGameMeal is not valid");
  if (x.result !== undefined && !["win", "draw", "loss"].includes(x.result)) e.push("result must be win, draw or loss");
  for (const k of ["started", "cleanSheet"] as const) if (x[k] !== undefined && typeof x[k] !== "boolean") e.push(`${k} must be true or false`);
  return e;
}

export interface SeasonStats {
  games: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  saves: number;
  cleanSheets: number;
  wins: number; draws: number; losses: number;
  per90: { goals: number | null; assists: number | null };
  avgRating: number | null;
  minutesByMonth: { month: string; minutes: number; games: number }[];
}

const sum = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b || 0), 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function seasonStats(logs: GameLog[], from?: string, to?: string): SeasonStats {
  const games = logs.filter((l) => (l.type === "match" || l.type === "tournament") && (!from || l.date >= from) && (!to || l.date <= to));
  const minutes = sum(games.map((g) => g.minutes));
  const goals = sum(games.map((g) => g.goals)), assists = sum(games.map((g) => g.assists));
  const rated = games.filter((g) => g.rating);
  const months = new Map<string, { minutes: number; games: number }>();
  for (const g of games) {
    const m = g.date.slice(0, 7);
    const cur = months.get(m) || { minutes: 0, games: 0 };
    months.set(m, { minutes: cur.minutes + (g.minutes || 0), games: cur.games + 1 });
  }
  return {
    games: games.length,
    starts: games.filter((g) => g.started).length,
    minutes, goals, assists,
    shots: sum(games.map((g) => g.shots)),
    saves: sum(games.map((g) => g.saves)),
    cleanSheets: games.filter((g) => g.cleanSheet).length,
    wins: games.filter((g) => g.result === "win").length,
    draws: games.filter((g) => g.result === "draw").length,
    losses: games.filter((g) => g.result === "loss").length,
    per90: minutes >= 90 ? { goals: r2((goals / minutes) * 90), assists: r2((assists / minutes) * 90) } : { goals: null, assists: null },
    avgRating: rated.length ? Math.round((sum(rated.map((g) => g.rating)) / rated.length) * 10) / 10 : null,
    minutesByMonth: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}

// ---------------------------------------------------------------------------
// "What worked": compare how games felt under different habits
// ---------------------------------------------------------------------------

export interface Insight { text: string; strength: "clear" | "hint"; games: number }

const MEAL_LABEL: Record<PreGameMeal, string> = {
  carb_meal: "a carb-rich meal", light_snack: "just a light snack", fast_food: "fast food", skipped: "skipping the pre-game meal", other: "something else",
};

/**
 * Needs at least 3 rated games on each side of a comparison, and a gap of
 * 0.5+ on the 1-5 scale, before it says anything. Correlation, not proof:
 * the wording says "followed", never "caused".
 */
export function whatWorked(profile: AthleteProfile, logs: GameLog[], checkins: DailyCheckIn[]): { insights: Insight[]; needMore: number } {
  const byDate = new Map(checkins.map((c) => [c.date, c]));
  const games = logs.filter((l) => (l.type === "match" || l.type === "tournament") && l.rating);
  const [sleepMin] = sleepHoursFor(effectiveAge(profile.identity));
  const insights: Insight[] = [];
  const avg = (xs: GameLog[]) => sum(xs.map((g) => g.rating)) / xs.length;
  const compare = (label: string, yes: (g: GameLog) => boolean | null, good: string, bad: string) => {
    const known = games.filter((g) => yes(g) !== null);
    const a = known.filter((g) => yes(g)), b = known.filter((g) => !yes(g));
    if (a.length < 3 || b.length < 3) return;
    const diff = avg(a) - avg(b);
    if (Math.abs(diff) < 0.5) return;
    insights.push({
      text: diff > 0 ? `Your best games followed ${good}. You rated them ${avg(a).toFixed(1)} vs ${avg(b).toFixed(1)}.` : `Games after ${bad} went better for you (${avg(b).toFixed(1)} vs ${avg(a).toFixed(1)}). Worth a look.`,
      strength: Math.abs(diff) >= 1 && a.length + b.length >= 10 ? "clear" : "hint",
      games: a.length + b.length,
    });
    void label;
  };
  compare("sleep", (g) => { const c = byDate.get(g.date); return c?.sleepHoursLastNight === undefined ? null : c.sleepHoursLastNight >= sleepMin; }, `${sleepMin}+ hours of sleep`, `less sleep`);
  compare("warmup", (g) => { const c = byDate.get(g.date); return c ? !!c.warmupDone : null; }, "the full injury-prevention warm-up", "a skipped warm-up");
  compare("hydration", (g) => { const c = byDate.get(g.date); return c?.urineColor === undefined ? null : c.urineColor <= 3; }, "a well-hydrated morning", "being a bit dehydrated");
  compare("stress", (g) => { const c = byDate.get(g.date); return c?.stressLevel === undefined ? null : c.stressLevel <= 5; }, "calmer days", "stressful days");
  compare("carb meal", (g) => (g.preGameMeal ? g.preGameMeal === "carb_meal" : null), "a carb-rich pre-game meal", "a different pre-game meal");
  // Meal types with the best average, when there's enough data.
  const meals = new Map<PreGameMeal, GameLog[]>();
  for (const g of games) if (g.preGameMeal) meals.set(g.preGameMeal, [...(meals.get(g.preGameMeal) || []), g]);
  const ranked = [...meals].filter(([, xs]) => xs.length >= 3).sort((x, y) => avg(y[1]) - avg(x[1]));
  if (ranked.length >= 2 && avg(ranked[0][1]) - avg(ranked[ranked.length - 1][1]) >= 0.8 && !insights.some((i) => i.text.includes("pre-game meal")))
    insights.push({ text: `Games after ${MEAL_LABEL[ranked[0][0]]} felt best. Games after ${MEAL_LABEL[ranked[ranked.length - 1][0]]} felt worst.`, strength: "hint", games: games.length });
  return { insights, needMore: Math.max(0, 6 - games.length) };
}
