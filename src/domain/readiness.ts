/**
 * Readiness score (pure).
 *
 * Folds a daily check-in into one 0-100 number plus a status and short advice.
 * Each input is scaled to 0-100 and weighted; missing inputs are skipped and
 * the weights re-normalised, so a partial check-in still scores.
 *
 *   sleep 30%  energy 20%  soreness 20% (inverted)  stress 15% (inverted)  hydration 15%
 *
 * This is a wellness signal to guide the day, not a medical assessment.
 */

import type { DailyCheckIn } from "./checkin.js";

export type ReadinessStatus = "ready" | "moderate" | "low";

export interface Readiness {
  date: string;
  score: number;
  status: ReadinessStatus;
  label: string;
  /** Which inputs pulled the score down, worst first. */
  limiters: string[];
  advice: string[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const scale10 = (v: number) => clamp(((v - 1) / 9) * 100);

export function computeReadiness(ci: DailyCheckIn | null | undefined): Readiness | null {
  if (!ci) return null;
  const parts: { key: string; w: number; v: number }[] = [];
  if (typeof ci.sleepHoursLastNight === "number")
    parts.push({ key: "sleep", w: 0.3, v: clamp(((ci.sleepHoursLastNight - 4) / 4.5) * 100) });
  if (typeof ci.energyLevel === "number") parts.push({ key: "energy", w: 0.2, v: scale10(ci.energyLevel) });
  if (typeof ci.sorenessLevel === "number") parts.push({ key: "soreness", w: 0.2, v: 100 - scale10(ci.sorenessLevel) });
  if (typeof ci.stressLevel === "number") parts.push({ key: "stress", w: 0.15, v: 100 - scale10(ci.stressLevel) });
  if (typeof ci.hydrationLevel === "number") parts.push({ key: "hydration", w: 0.15, v: scale10(ci.hydrationLevel) });
  if (!parts.length) return null;

  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / wsum);
  const status: ReadinessStatus = score >= 75 ? "ready" : score >= 55 ? "moderate" : "low";
  const limiters = parts.filter((p) => p.v < 55).sort((a, b) => a.v - b.v).map((p) => p.key);

  const advice: string[] = [];
  for (const k of limiters) {
    if (k === "sleep") advice.push("Short sleep: get carbs and fluids in early, and protect an early bedtime tonight.");
    if (k === "energy") advice.push("Low energy: do not skip breakfast. Hit your carbohydrate target before training.");
    if (k === "soreness") advice.push("High soreness: longer warm-up, mobility work, and protein at every meal.");
    if (k === "stress") advice.push("High stress: keep the day simple. A short walk and a regular bedtime help.");
    if (k === "hydration") advice.push("Behind on fluids: drink 500 ml now and keep a bottle with you all day.");
  }
  if (!advice.length) advice.push("You are good to go. Stick to the plan.");

  return {
    date: ci.date,
    score,
    status,
    label: status === "ready" ? "Ready" : status === "moderate" ? "Moderate" : "Take it easy",
    limiters,
    advice,
  };
}

/** Session load (session-RPE method): minutes x effort. */
export function sessionLoad(ci: DailyCheckIn): number {
  if (typeof ci.sessionMinutes !== "number" || typeof ci.sessionRpe !== "number") return 0;
  return Math.round(ci.sessionMinutes * ci.sessionRpe);
}
