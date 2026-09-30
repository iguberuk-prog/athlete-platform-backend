/**
 * Streaks and badges (pure). Rewards habits only: checking in, warming up,
 * sleeping enough, drinking enough, reflecting after games. Nothing about
 * body size, weight or looks, at any age.
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { effectiveAge } from "./profile.js";
import { sleepHoursFor } from "./ageBands.js";
import { addDays } from "./dates.js";

export interface Streak { id: string; label: string; current: number; best: number; unit: string; doneToday: boolean; tip: string }
export interface Badge { id: string; name: string; detail: string; earned: boolean; earnedOn?: string; progress: number; goal: number; icon: string }

export interface Progress {
  streaks: Streak[];
  badges: Badge[];
  earnedCount: number;
  /** Something to celebrate right now (for a toast). */
  newest?: string;
  points: number;
}

/** Days in a row ending today (or yesterday, so a streak isn't "lost" before today's check-in). */
function runs(days: Set<string>, today: string): { current: number; best: number; doneToday: boolean } {
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = "";
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const doneToday = days.has(today);
  let current = 0;
  let d = doneToday ? today : addDays(today, -1);
  while (days.has(d)) { current++; d = addDays(d, -1); }
  return { current, best, doneToday };
}

export interface ProgressInputs {
  checkins: DailyCheckIn[];
  /** Dates of post-game reflections. */
  reflectionDates: string[];
  /** Dates of completed skills homework (team feature). */
  homeworkDates?: string[];
}

export function buildProgress(profile: AthleteProfile, inp: ProgressInputs, today: string): Progress {
  const age = effectiveAge(profile.identity);
  const [sleepMin] = sleepHoursFor(age);
  const cis = inp.checkins.filter((c) => c.date <= today);
  const checkDays = new Set(cis.map((c) => c.date));
  const sleepDays = new Set(cis.filter((c) => (c.sleepHoursLastNight ?? 0) >= sleepMin).map((c) => c.date));
  const hydDays = new Set(cis.filter((c) => (c.urineColor !== undefined ? c.urineColor <= 3 : (c.hydrationLevel ?? 0) >= 7)).map((c) => c.date));
  const warm = cis.filter((c) => c.warmupDone).map((c) => c.date).sort();
  // Warm-up streak counts weeks with 2+ warm-ups (you don't warm up on rest days).
  const weekOf = (d: string) => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
  const weekCounts = new Map<string, number>();
  for (const d of warm) weekCounts.set(weekOf(d), (weekCounts.get(weekOf(d)) || 0) + 1);
  const goodWeeks = new Set([...weekCounts].filter(([, n]) => n >= 2).map(([w]) => w));
  let wkCurrent = 0, wk = weekOf(today);
  if (!goodWeeks.has(wk)) wk = addDays(wk, -7);
  while (goodWeeks.has(wk)) { wkCurrent++; wk = addDays(wk, -7); }
  let wkBest = 0, wkRun = 0, wkPrev = "";
  for (const w of [...goodWeeks].sort()) { wkRun = wkPrev && addDays(wkPrev, 7) === w ? wkRun + 1 : 1; wkBest = Math.max(wkBest, wkRun); wkPrev = w; }

  const c = runs(checkDays, today), s = runs(sleepDays, today), h = runs(hydDays, today);
  const streaks: Streak[] = [
    { id: "checkin", label: "Check-in streak", ...c, unit: "days", tip: "Check in every day, even rest days." },
    { id: "sleep", label: "Sleep on target", ...s, unit: "nights", tip: `${sleepMin}+ hours a night.` },
    { id: "hydration", label: "Hydration", ...h, unit: "days", tip: "Pale pee or hydration 7+ in your check-in." },
    { id: "warmup", label: "Warm-up weeks", current: wkCurrent, best: wkBest, doneToday: warm.includes(today), unit: "weeks", tip: "Do the injury-prevention warm-up 2+ times a week." },
  ];

  const refl = [...new Set(inp.reflectionDates)].sort();
  const hw = [...new Set(inp.homeworkDates || [])].sort();
  const nth = (arr: string[], n: number) => (arr.length >= n ? arr[n - 1] : undefined);
  const dayWhenRunHit = (set: Set<string>, n: number): string | undefined => {
    const sorted = [...set].sort(); let run = 0, prev = "";
    for (const d of sorted) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; prev = d; if (run === n) return d; }
    return undefined;
  };
  const allCheck = [...checkDays].sort();
  const B = (id: string, name: string, detail: string, icon: string, progress: number, goal: number, earnedOn?: string): Badge =>
    ({ id, name, detail, icon, progress: Math.min(progress, goal), goal, earned: progress >= goal, earnedOn: progress >= goal ? earnedOn : undefined });
  const badges: Badge[] = [
    B("first", "First step", "Your first check-in.", "star", allCheck.length, 1, allCheck[0]),
    B("week", "One week strong", "Check in 7 days in a row.", "flame", c.best, 7, dayWhenRunHit(checkDays, 7)),
    B("month", "Habit locked in", "Check in 30 days in a row.", "flame", c.best, 30, dayWhenRunHit(checkDays, 30)),
    B("hundred", "100 club", "100 check-ins.", "trophy", allCheck.length, 100, nth(allCheck, 100)),
    B("sleep7", "Sleep champ", "7 nights in a row on your sleep target.", "moon", s.best, 7, dayWhenRunHit(sleepDays, 7)),
    B("hyd7", "Hydration hero", "7 days in a row well hydrated.", "drop", h.best, 7, dayWhenRunHit(hydDays, 7)),
    B("warm10", "Warm-up pro", "10 injury-prevention warm-ups.", "shield", warm.length, 10, nth(warm, 10)),
    B("warm4w", "Built to last", "4 weeks in a row with 2+ warm-ups.", "shield", wkBest, 4),
    B("reflect5", "Student of the game", "5 post-game reflections.", "book", refl.length, 5, nth(refl, 5)),
    B("reflect20", "Season storyteller", "20 post-game reflections.", "book", refl.length, 20, nth(refl, 20)),
    B("breathe5", "Cool head", "5 breathing exercises.", "wind", cis.filter((x) => x.breathingDone).length, 5),
    ...(hw.length ? [B("homework10", "Extra work", "10 skills homework sessions.", "ball", hw.length, 10, nth(hw, 10))] : []),
  ];
  const earned = badges.filter((b) => b.earned);
  const newest = earned.filter((b) => b.earnedOn === today).map((b) => b.name)[0];
  const points = allCheck.length * 10 + warm.length * 5 + refl.length * 15 + s.best * 2 + h.best * 2 + hw.length * 10;
  return { streaks, badges, earnedCount: earned.length, newest, points };
}
