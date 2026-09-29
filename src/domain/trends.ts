/**
 * Trends from daily check-ins (pure).
 *
 * Produces a day-by-day series for charts plus two summaries:
 *
 *  - 7-day averages for sleep, energy, soreness and readiness
 *  - training load (session-RPE: minutes x effort) with the acute:chronic
 *    ratio, this week's load against the average week of the last four.
 *    Above ~1.5 is a spike worth easing off; below ~0.8 is a big drop.
 *    The ratio is only shown once there are 14+ days of history.
 */

import type { DailyCheckIn } from "./checkin.js";
import { computeReadiness, sessionLoad } from "./readiness.js";
import { addDays, daysBetween } from "./dates.js";

export interface TrendPoint {
  date: string;
  sleep: number | null;
  energy: number | null;
  soreness: number | null;
  readiness: number | null;
  load: number;
}

export interface TrendSummary {
  profileId: string;
  from: string;
  to: string;
  days: TrendPoint[];
  averages7: { sleep: number | null; energy: number | null; soreness: number | null; readiness: number | null };
  load: {
    acute7: number;
    chronicWeekly: number | null;
    ratio: number | null;
    status: "spike" | "high" | "steady" | "low" | "not_enough_data";
    message: string;
  };
  checkinStreak: number;
  weeklyLoads: { weekStart: string; load: number }[];
}

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export function buildTrends(
  profileId: string,
  checkins: DailyCheckIn[],
  today: string,
  windowDays = 28,
): TrendSummary {
  const byDate = new Map(checkins.map((c) => [c.date, c]));
  const from = addDays(today, -(windowDays - 1));

  const days: TrendPoint[] = [];
  for (let i = 0; i < windowDays; i++) {
    const date = addDays(from, i);
    const c = byDate.get(date);
    days.push({
      date,
      sleep: c?.sleepHoursLastNight ?? null,
      energy: c?.energyLevel ?? null,
      soreness: c?.sorenessLevel ?? null,
      readiness: c ? computeReadiness(c)?.score ?? null : null,
      load: c ? sessionLoad(c) : 0,
    });
  }

  const last7 = days.slice(-7);
  const loadIn = (a: string, b: string) =>
    checkins
      .filter((c) => c.date >= a && c.date <= b)
      .reduce((s, c) => s + sessionLoad(c), 0);

  const acute7 = loadIn(addDays(today, -6), today);
  const chronic28 = loadIn(addDays(today, -27), today);
  const oldest = checkins.map((c) => c.date).sort()[0];
  const history = oldest ? daysBetween(oldest, today) + 1 : 0;
  const chronicWeekly = history >= 14 ? Math.round(chronic28 / Math.min(4, history / 7)) : null;
  const ratio = chronicWeekly && chronicWeekly > 0 ? Math.round((acute7 / chronicWeekly) * 100) / 100 : null;

  let status: TrendSummary["load"]["status"] = "not_enough_data";
  let message = "Log minutes and effort after practices and games. The load ratio appears after two weeks.";
  if (ratio !== null) {
    if (ratio > 1.5) {
      status = "spike";
      message = "Load jumped well above your normal week. Ease off and prioritise sleep and fuel.";
    } else if (ratio > 1.3) {
      status = "high";
      message = "A heavier week than usual. Keep recovery tight.";
    } else if (ratio >= 0.8) {
      status = "steady";
      message = "Load is in your normal range.";
    } else {
      status = "low";
      message = "A lighter week than usual. Fine for recovery or a taper.";
    }
  }

  // Consecutive days with a check-in, ending today (or yesterday).
  let streak = 0;
  let cursor = byDate.has(today) ? today : addDays(today, -1);
  while (byDate.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const weeklyLoads: { weekStart: string; load: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const end = addDays(today, -7 * w);
    const start = addDays(end, -6);
    weeklyLoads.push({ weekStart: start, load: loadIn(start, end) });
  }

  return {
    profileId,
    from,
    to: today,
    days,
    averages7: {
      sleep: avg(last7.map((d) => d.sleep)),
      energy: avg(last7.map((d) => d.energy)),
      soreness: avg(last7.map((d) => d.soreness)),
      readiness: avg(last7.map((d) => d.readiness)),
    },
    load: { acute7, chronicWeekly, ratio, status, message },
    checkinStreak: streak,
    weeklyLoads,
  };
}
