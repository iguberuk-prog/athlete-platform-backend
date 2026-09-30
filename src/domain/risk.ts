/**
 * Early warning score (pure): one "injury risk this week" signal built from
 * what we already collect. It is a heads-up to ease off, not a diagnosis.
 *
 *   sleep debt      last 7 nights vs the age target
 *   load spike      acute:chronic workload (session minutes x effort), when
 *                   there are 3+ weeks of data; otherwise scheduled hours
 *                   this week vs last week
 *   soreness        recent soreness level and repeat sore spots
 *   stress          high stress most days
 *   growth spurt    fast growth in young players
 *   illness         sick or fever in the last week
 *   overuse         weekly hours above the age guideline
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { effectiveAge } from "./profile.js";
import { sleepHoursFor } from "./ageBands.js";
import { addDays, eventDate, sortedEvents } from "./dates.js";
import { growthStatus, loadGuard, sorenessAlerts, activeConcussion } from "./health.js";
import { durationOf } from "./weather.js";

export interface RiskFactor { id: string; points: number; text: string }
export interface RiskScore {
  score: number;
  level: "low" | "moderate" | "high";
  factors: RiskFactor[];
  actions: string[];
  acwr: number | null;
  dataDays: number;
  notCleared: boolean;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function riskScore(profile: AthleteProfile, checkins: DailyCheckIn[], today: string): RiskScore {
  const age = effectiveAge(profile.identity);
  const in7 = checkins.filter((c) => c.date <= today && c.date > addDays(today, -7));
  const in28 = checkins.filter((c) => c.date <= today && c.date > addDays(today, -28));
  const f: RiskFactor[] = [];

  const [sleepMin] = sleepHoursFor(age);
  const sl = avg(in7.map((c) => c.sleepHoursLastNight).filter((x): x is number => typeof x === "number"));
  if (sl !== null && sl < sleepMin) {
    const debt = sleepMin - sl;
    f.push({ id: "sleep", points: Math.min(25, Math.round(debt * 12)), text: `Sleeping about ${sl.toFixed(1)} h a night, ${debt.toFixed(1)} h under target.` });
  }

  // Workload: session-RPE when there's enough history.
  const load = (from: string, to: string) => in28.filter((c) => c.date > from && c.date <= to).reduce((a, c) => a + (c.sessionMinutes || 0) * (c.sessionRpe || 0), 0);
  const weeksWithLoad = [0, 1, 2, 3].filter((w) => load(addDays(today, -7 * (w + 1)), addDays(today, -7 * w)) > 0).length;
  let acwr: number | null = null;
  if (weeksWithLoad >= 3) {
    const acute = load(addDays(today, -7), today);
    const chronic = load(addDays(today, -28), today) / 4;
    acwr = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;
    if (acwr !== null && acwr > 1.5) f.push({ id: "spike", points: 25, text: `Training load jumped: this week is ${acwr} times your 4-week average.` });
    else if (acwr !== null && acwr > 1.3) f.push({ id: "spike", points: 12, text: `Training load is climbing (${acwr} times your 4-week average).` });
  } else {
    const hours = (from: string, to: string) => sortedEvents(profile).filter((e) => (e.type === "match" || e.type === "training" || e.type === "tournament") && eventDate(e) > from && eventDate(e) <= to).reduce((a, e) => a + durationOf(profile, e), 0) / 60;
    const thisWk = hours(addDays(today, -4), addDays(today, 3)), lastWk = hours(addDays(today, -11), addDays(today, -4));
    if (lastWk >= 2 && thisWk / lastWk > 1.5) f.push({ id: "spike", points: 15, text: `About ${Math.round(thisWk)} hours of soccer this week vs ${Math.round(lastWk)} last week.` });
  }

  const sore3 = avg(in7.filter((c) => c.date > addDays(today, -3)).map((c) => c.sorenessLevel).filter((x): x is number => typeof x === "number"));
  if (sore3 !== null && sore3 >= 6) f.push({ id: "soreness", points: sore3 >= 8 ? 20 : 12, text: `High soreness the last few days (${sore3.toFixed(0)}/10).` });
  const spots = sorenessAlerts(checkins, today, age);
  if (spots.length) f.push({ id: "spots", points: spots.some((s) => s.level === "stop") ? 20 : 12, text: spots.map((s) => s.title.replace("Keep an eye on the ", "Sore ")).join(", ") + "." });

  const stressed = in7.filter((c) => (c.stressLevel ?? 0) >= 7).length;
  if (stressed >= 4) f.push({ id: "stress", points: 10, text: `High stress on ${stressed} of the last 7 days.` });
  const g = age !== undefined && age < 19 ? growthStatus(profile, today) : null;
  if (g?.spurt) f.push({ id: "growth", points: 10, text: `Growing fast (${g.cmPerYear} cm a year).` });
  if (in7.some((c) => c.fever || c.sick)) f.push({ id: "ill", points: 10, text: "Sick in the last week. The body needs a few easy days to bounce back." });
  if (age !== undefined && age < 19) {
    const lg = loadGuard(profile, today);
    if (lg.maxHours !== null && lg.weekHours > lg.maxHours) f.push({ id: "overuse", points: 10, text: `${lg.weekHours} hours scheduled this week, over the ${lg.maxHours}-hour guideline.` });
  }

  f.sort((a, b) => b.points - a.points);
  const score = Math.min(100, f.reduce((a, x) => a + x.points, 0));
  const level: RiskScore["level"] = score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  const actions: string[] = [];
  if (level === "high") actions.push("Ease off this week: skip optional sessions and keep hard sprints and jumps short.");
  if (f.some((x) => x.id === "sleep")) actions.push("Move bedtime 30 minutes earlier for the next 5 nights.");
  if (f.some((x) => x.id === "spike")) actions.push("Build training up by no more than about 10% a week.");
  if (f.some((x) => x.id === "spots")) actions.push("Get the sore spot checked by an athletic trainer or doctor.");
  if (f.some((x) => x.id === "growth")) actions.push("Growth spurt: fewer jumps and sprints, more rest.");
  if (level === "low") actions.push("Looking good. Keep sleeping, fueling and warming up.");
  return { score, level, factors: f, actions, acwr, dataDays: in28.length, notCleared: !!activeConcussion(profile) };
}
