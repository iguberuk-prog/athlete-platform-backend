/**
 * Player health and safety engine (pure, no I/O).
 *
 * Everything here turns what we already collect (profile, daily check-ins,
 * schedule, weather) into plain-language guidance and alerts:
 *
 *   sweat tests, urine color, soreness map, growth spurts, asthma,
 *   concussion return-to-play (CDC HEADS UP ladder), menstrual cycle (opt-in),
 *   stress and burnout, warm-ups, sick-day rule, overuse guard,
 *   heat acclimatization, and under-fueling signals.
 *
 * Alerts carry an audience so the UI can show the right thing to the right
 * person: "player" (the athlete or the parent of a young child), "parent"
 * (quiet alerts for the family only), and "coach" (the minimum a coach needs
 * to keep a player safe: not cleared to play, EpiPen, inhaler).
 */

import type { AthleteProfile, ConcussionCase, SweatTest } from "./profile.js";
import { effectiveAge } from "./profile.js";
import type { DailyCheckIn, BodyRegion } from "./checkin.js";
import { bandForAge, parentVoice } from "./ageBands.js";
import { addDays, daysBetween, eventDate, eventTime, sortedEvents, toMin, to12, fromMin, routineOf } from "./dates.js";
import { examples, safetyContext } from "./foods.js";
import { durationOf } from "./weather.js";
import { featuresFor, type FeatureSet } from "./features.js";

export type AlertLevel = "stop" | "warn" | "info";
export type Audience = "player" | "parent" | "coach";

export interface HealthAlert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  audience: Audience[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const firstName = (p: AthleteProfile) => (p.identity.fullName || "").trim().split(/\s+/)[0] || "your athlete";

// ---------------------------------------------------------------------------
// Sweat test
// ---------------------------------------------------------------------------

export interface SweatTestInput {
  date: string;
  preKg: number;
  postKg: number;
  fluidL: number;
  urineL?: number;
  minutes: number;
  tempF?: number;
}

/** Sweat rate (L/h) = (pre - post + fluid - urine) / hours. 1 kg of mass lost is about 1 L of sweat. */
export function computeSweatTest(t: SweatTestInput, id: string): SweatTest | { error: string } {
  if (!(t.preKg > 15 && t.preKg < 200 && t.postKg > 15 && t.postKg < 200)) return { error: "Weights look off. Enter them in kilograms." };
  if (!(t.minutes >= 20 && t.minutes <= 300)) return { error: "The session should be 20 to 300 minutes long." };
  if (!(t.fluidL >= 0 && t.fluidL <= 8)) return { error: "Fluid drunk should be 0 to 8 litres." };
  const urine = t.urineL && t.urineL > 0 ? t.urineL : 0;
  const lost = t.preKg - t.postKg + t.fluidL - urine;
  const rate = lost / (t.minutes / 60);
  if (rate < 0 || rate > 4.5) return { error: "That works out to an impossible sweat rate. Check the numbers and try again." };
  return {
    id, date: t.date, preKg: t.preKg, postKg: t.postKg, fluidL: t.fluidL, urineL: urine || undefined, minutes: t.minutes,
    tempF: t.tempF, rateLph: r1(rate) || 0.1, lossPct: r1(((t.preKg - t.postKg) / t.preKg) * 100),
  };
}

export function medianSweatRate(tests: SweatTest[]): number | undefined {
  const v = tests.map((t) => t.rateLph).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = Math.floor(v.length / 2);
  return r1(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
}

export function sweatAdvice(t: SweatTest, age?: number): string[] {
  const out: string[] = [];
  const perBreak = Math.round((t.rateLph * 1000) / 4 / 10) * 10;
  out.push(`Sweat rate: about ${t.rateLph} L per hour.`);
  if (t.lossPct >= 2) out.push(`Lost ${t.lossPct}% of body weight. Above 2% hurts speed and decisions. Drink more during play next time.`);
  else if (t.lossPct < 0) out.push("Gained weight during the session: drinking more than needed. Ease off a little.");
  else out.push(`Lost ${t.lossPct}% of body weight. Under 2% is the goal. Good.`);
  const replace = Math.round((t.preKg - t.postKg) * 1.5 * 10) / 10;
  if (replace > 0) out.push(`After a session like this, drink about ${replace} L over the next few hours (1.5 times the weight lost).`);
  if ((age ?? 18) >= 13) out.push(`In a hot game, aim for roughly ${perBreak} ml every 15 minutes you can get it.`);
  if (t.rateLph >= 1.5) out.push("Heavy sweater: add electrolytes or a sports drink on hot days, and salt meals.");
  return out;
}

// ---------------------------------------------------------------------------
// Urine color (1 pale to 8 dark)
// ---------------------------------------------------------------------------

export function urineAdvice(color: number | undefined): { status: "good" | "low" | "dehydrated"; text: string } | null {
  if (!color) return null;
  if (color <= 3) return { status: "good", text: "Pale yellow: well hydrated. Keep it up." };
  if (color <= 5) return { status: "low", text: "Getting darker: drink 2 cups of water in the next hour, then keep sipping." };
  return { status: "dehydrated", text: "Dark: dehydrated. Drink 2 to 3 cups now and more with every meal. If it stays dark or there is pain, tell a parent or doctor." };
}

// ---------------------------------------------------------------------------
// Soreness body map
// ---------------------------------------------------------------------------

export const REGION_LABEL: Record<BodyRegion, string> = {
  head: "head", neck: "neck", shoulder_l: "left shoulder", shoulder_r: "right shoulder", back: "upper back",
  lower_back: "lower back", hip_l: "left hip", hip_r: "right hip", groin: "groin", quad_l: "left thigh (front)",
  quad_r: "right thigh (front)", hamstring_l: "left hamstring", hamstring_r: "right hamstring", knee_l: "left knee",
  knee_r: "right knee", shin_l: "left shin", shin_r: "right shin", calf_l: "left calf", calf_r: "right calf",
  ankle_l: "left ankle", ankle_r: "right ankle", heel_l: "left heel", heel_r: "right heel", foot_l: "left foot", foot_r: "right foot",
};

const lastN = (checkins: DailyCheckIn[], today: string, n: number) =>
  checkins.filter((c) => c.date <= today && c.date > addDays(today, -n));

/**
 * Pain that keeps coming back is how overuse injuries start.
 * Flag: same spot 4+ on 3 of the last 7 check-ins, or 7+ two days running.
 */
export function sorenessAlerts(checkins: DailyCheckIn[], today: string, age?: number): HealthAlert[] {
  const week = lastN(checkins, today, 7);
  const byRegion = new Map<BodyRegion, { date: string; level: number }[]>();
  for (const c of week) for (const s of c.soreSpots || []) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region)!.push({ date: c.date, level: s.level });
  }
  const out: HealthAlert[] = [];
  const growing = (age ?? 30) < 16;
  for (const [region, logs] of byRegion) {
    const sorted = logs.sort((a, b) => a.date.localeCompare(b.date));
    const often = sorted.filter((l) => l.level >= 4).length >= 3;
    let sharp = false;
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i].level >= 7 && sorted[i - 1].level >= 7 && daysBetween(sorted[i - 1].date, sorted[i].date) === 1) sharp = true;
    if (!often && !sharp) continue;
    const label = REGION_LABEL[region];
    let detail = sharp
      ? `Strong pain in the ${label} two days in a row. Rest it and get it checked by a doctor or athletic trainer before the next hard session.`
      : `The ${label} has been sore on 3 or more days this week. Cut back on hard running and jumping for a few days, and get it checked if it doesn't ease.`;
    if (growing && /knee/.test(region)) detail += " Knee pain below the kneecap during a growth spurt is common in young players and needs rest, not playing through.";
    if (growing && /heel/.test(region)) detail += " Heel pain in growing kids is common and usually settles with rest and less sprinting on hard ground.";
    if (/shin/.test(region)) detail += " Shin pain that is sharp in one spot can be a stress injury. Don't play through it.";
    out.push({ id: `sore:${region}`, level: sharp ? "stop" : "warn", title: `Keep an eye on the ${label}`, detail, audience: ["player", "parent"] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

export interface GrowthStatus {
  cmPerYear: number | null;
  spurt: boolean;
  readings: number;
  advice: string[];
}

/** Uses readings at least 90 days apart. A spurt is 7+ cm a year under 18. */
export function growthStatus(profile: AthleteProfile, today: string): GrowthStatus | null {
  const age = effectiveAge(profile.identity);
  if (age === undefined || age >= 20) return null;
  const h = [...(profile.anthropometrics.heightHistory || [])].filter((x) => x.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const advice: string[] = [];
  if (h.length < 2) {
    advice.push("Measure height every 3 months (same time of day, no shoes). We'll spot growth spurts, when injury risk goes up.");
    return { cmPerYear: null, spurt: false, readings: h.length, advice };
  }
  const last = h[h.length - 1];
  const base = [...h].reverse().find((x) => daysBetween(x.date, last.date) >= 90);
  if (!base) {
    advice.push("Next height check in a few weeks gives us a growth rate.");
    return { cmPerYear: null, spurt: false, readings: h.length, advice };
  }
  const rate = r1(((last.heightCm - base.heightCm) / daysBetween(base.date, last.date)) * 365);
  const spurt = age < 18 && rate >= 7;
  if (spurt) {
    advice.push(`Growing fast: about ${rate} cm a year. Bones grow before muscles catch up, so knees, heels and back take more strain.`);
    advice.push("Fewer jumps and hard sprints on busy weeks, more sleep, and don't skip meals. Growth itself uses a lot of energy.");
    advice.push("Coordination can dip for a few months. That's normal and passes.");
  } else advice.push(`Growing about ${rate} cm a year.`);
  return { cmPerYear: rate, spurt, readings: h.length, advice };
}

// ---------------------------------------------------------------------------
// Asthma
// ---------------------------------------------------------------------------

export function asthmaPlan(profile: AthleteProfile): string[] {
  const a = profile.health?.asthma;
  if (!a?.has) return [];
  const out: string[] = [];
  if (a.preExerciseInhaler) out.push("Use the inhaler 15 minutes before warm-up, as the doctor prescribed.");
  out.push("Rescue inhaler in the bag for every practice and game. Tell the coach where it is.");
  out.push("A longer, easier warm-up helps keep the airways calm.");
  if ((a.triggers || []).some((t) => /cold/i.test(t))) out.push("Cold air is a trigger: breathe through a neck gaiter or scarf until you're warmed up.");
  out.push("Stop and use the inhaler at the first tight chest, wheeze or cough. If it doesn't help in a few minutes, or lips turn blue, call 911.");
  return out;
}

// ---------------------------------------------------------------------------
// Concussion: CDC HEADS UP return-to-sport ladder
// ---------------------------------------------------------------------------

/** Our wording of the six CDC HEADS UP steps (step 0 = rest and recover). */
export const RETURN_STEPS = [
  { step: 0, title: "Rest and recover", detail: "Rest the brain and body for the first day or two. Light daily activity is fine if it doesn't make symptoms worse. Limit screens." },
  { step: 1, title: "Back to regular activities", detail: "Normal day at home and school, as long as symptoms don't get worse." },
  { step: 2, title: "Light aerobic activity", detail: "Easy walking or a stationary bike for 5 to 10 minutes. No weights, no jumping, no hard running." },
  { step: 3, title: "Moderate activity", detail: "Jogging or brief running, moderate stationary biking, light weights. Less time and effort than normal." },
  { step: 4, title: "Heavy, non-contact activity", detail: "Sprinting, harder running, passing and dribbling drills, normal weight training. No contact and no heading." },
  { step: 5, title: "Practice with full contact", detail: "Full practice, only after written clearance from a health care provider." },
  { step: 6, title: "Competition", detail: "Back to games." },
] as const;

export const DANGER_SIGNS = [
  "One pupil larger than the other",
  "Drowsy or can't be woken up",
  "Headache that gets worse and does not go away",
  "Slurred speech, weakness, numbness, or poor coordination",
  "Repeated vomiting, convulsions or seizures",
  "Very confused, restless or agitated, or acting strangely",
  "Passed out, even briefly",
];

export interface ConcussionStatus {
  active: boolean;
  caseId?: string;
  step: number;
  stepTitle?: string;
  stepDetail?: string;
  /** Not cleared by a provider for full play. */
  notCleared: boolean;
  canAdvance: boolean;
  nextAllowedDate?: string;
  needsProviderClearance: boolean;
  message: string;
}

export function activeConcussion(profile: AthleteProfile): ConcussionCase | undefined {
  return (profile.health?.concussions || []).find((c) => !c.clearedAt);
}

/** Each step takes at least 24 hours; symptoms send you back a step. Step 5+ needs a provider's clearance. */
export function concussionStatus(profile: AthleteProfile, today: string, todayCheckin?: DailyCheckIn | null): ConcussionStatus {
  const c = activeConcussion(profile);
  if (!c) return { active: false, step: 6, notCleared: false, canAdvance: false, needsProviderClearance: false, message: "" };
  const last = c.stepHistory[c.stepHistory.length - 1];
  const lastDate = last?.date || c.date;
  const symptoms = !!todayCheckin?.headSymptoms;
  const waited = daysBetween(lastDate, today) >= 1;
  const needsProviderClearance = c.step >= 4;
  const canAdvance = waited && !symptoms && c.step < 4;
  const s = RETURN_STEPS[Math.min(c.step, 6)];
  let message = `Step ${c.step} of 6: ${s.title}.`;
  if (symptoms) message += " Symptoms today: stay at this step or go back one, and call the doctor if they get worse.";
  else if (needsProviderClearance) message += " Next step needs written clearance from a health care provider.";
  else if (!waited) message += ` Each step takes at least 24 hours. Next step no sooner than ${addDays(lastDate, 1)}.`;
  else message += " No symptoms: OK to try the next step today.";
  return {
    active: true, caseId: c.id, step: c.step, stepTitle: s.title, stepDetail: s.detail, notCleared: true,
    canAdvance, nextAllowedDate: waited ? today : addDays(lastDate, 1), needsProviderClearance, message,
  };
}

// ---------------------------------------------------------------------------
// Menstrual cycle (opt-in)
// ---------------------------------------------------------------------------

export interface CycleStatus {
  tracking: boolean;
  lastStart?: string;
  daysSince?: number;
  predictedNext?: string;
  advice: string[];
  alert?: HealthAlert;
}

export function cycleStatus(profile: AthleteProfile, checkins: DailyCheckIn[], today: string): CycleStatus | null {
  if (profile.identity.sex !== "female" || !profile.advanced?.menstrualCycleTracking) return null;
  const days = checkins.filter((c) => c.period && c.date <= today).map((c) => c.date).sort();
  // Period starts: a period day with no period the day before.
  const set = new Set(days);
  const starts = days.filter((d) => !set.has(addDays(d, -1)));
  const lastStart = starts[starts.length - 1];
  const len = profile.advanced?.cycleLengthDays || 28;
  const advice: string[] = [];
  const todayCi = checkins.find((c) => c.date === today);
  if (todayCi?.period) {
    advice.push("Iron matters on period days: " + examples(safetyContext(profile), ["beef", "lentils", "beans", "tofu", "eggs", "greens"], 3, "protein", "iron-rich foods") + ", with fruit for vitamin C to help absorb it.");
    if (todayCi.cycleSymptoms?.includes("cramps")) advice.push("Cramps: a warm pack, gentle movement and staying hydrated often help. Training is fine if you feel up to it.");
    if (todayCi.cycleSymptoms?.includes("heavy_flow")) advice.push("Heavy flow regularly can lower iron. Worth asking a doctor about an iron check.");
    if (todayCi.cycleSymptoms?.includes("tired")) advice.push("Feeling tired is common. Keep the carbs up and get to bed on time.");
  }
  const out: CycleStatus = { tracking: true, lastStart, advice };
  if (lastStart) {
    out.daysSince = daysBetween(lastStart, today);
    out.predictedNext = addDays(lastStart, len);
    const age = effectiveAge(profile.identity) ?? 20;
    // Only flag when we have enough history to trust it (logging for 90+ days).
    const firstLog = checkins.map((c) => c.date).sort()[0];
    if (out.daysSince >= 90 && age >= 15 && firstLog && daysBetween(firstLog, today) >= 90) {
      out.alert = {
        id: "cycle:missed", level: "warn", title: "No period logged in 3 months",
        detail: "Missing periods in an athlete can mean the body isn't getting enough fuel for training. It's worth seeing a doctor, and eating more on training days.",
        audience: ["player", "parent"],
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stress, burnout, breathing
// ---------------------------------------------------------------------------

export const BREATHING = [
  { id: "box", name: "Box breathing", minutes: 2, steps: ["Breathe in for 4 counts", "Hold for 4", "Breathe out for 4", "Hold for 4", "Repeat 6 to 8 times"], when: "Before a game when nerves kick in." },
  { id: "long_exhale", name: "Long exhale", minutes: 3, steps: ["Breathe in through the nose for 4 counts", "Breathe out slowly through the mouth for 6 to 8 counts", "Repeat 10 times"], when: "At night to wind down, or after a mistake on the field." },
  { id: "reset", name: "One-breath reset", minutes: 0.5, steps: ["Big breath in through the nose", "A second short sip of air on top", "Long, slow breath out", "Pick one next job: 'win the next ball'"], when: "During a game, after a goal against or a bad play." },
];

/** For players under 10: simple and playful. */
export const KID_BREATHING = [
  { id: "balloon", name: "Balloon breathing", minutes: 1, steps: ["Put your hands on your belly", "Breathe in slowly and blow your belly up like a balloon", "Let the air out slowly, like a balloon going down", "Do it 5 times"], when: "Before a game, or when feeling upset." },
  { id: "birthday", name: "Birthday candles", minutes: 1, steps: ["Hold up 5 fingers", "Take a big breath in", "Blow out one finger 'candle' at a time", "Do all 5"], when: "Any time you want to calm down." },
];

export const SUPPORT = {
  crisis: "If you ever feel like hurting yourself or that things are hopeless, call or text 988 (Suicide & Crisis Lifeline) any time. If you're in danger, call 911.",
  talk: "Talking to a parent, coach, school counselor or doctor about stress is a strong move, not a weak one.",
};

export function wellbeing(profile: AthleteProfile, checkins: DailyCheckIn[], today: string): { alerts: HealthAlert[]; tips: string[] } {
  const week = lastN(checkins, today, 7);
  const alerts: HealthAlert[] = [];
  const tips: string[] = [];
  const kid = parentVoice(effectiveAge(profile.identity));
  const stressed = week.filter((c) => (c.stressLevel ?? 0) >= 7).length;
  const lowFun = week.filter((c) => c.enjoyment !== undefined && c.enjoyment <= 4).length;
  const lowMood = week.filter((c) => c.mood === "low" || c.mood === "bad").length;
  const tired = week.filter((c) => (c.energyLevel ?? 10) <= 3).length;
  if (stressed >= 4 || (lowFun >= 3 && tired >= 2) || lowMood >= 4) {
    alerts.push({
      id: "burnout", level: "warn", title: kid ? `${firstName(profile)} seems worn down` : "Signs of burnout",
      detail: [
        stressed >= 4 ? "High stress on 4 or more days this week." : "",
        lowFun >= 3 ? "Enjoying the sport less." : "",
        lowMood >= 4 ? "Low mood most days." : "",
        "A lighter week, a day fully off, and a real talk about how things are going can help a lot.",
      ].filter(Boolean).join(" "),
      audience: ["player", "parent"],
    });
    tips.push(SUPPORT.talk);
  }
  if (week.some((c) => (c.stressLevel ?? 0) >= 6)) tips.push("Try the long-exhale breathing tonight: 3 minutes before bed.");
  if (week.some((c) => (c.schoolLoad ?? 0) >= 4)) tips.push("Heavy school load this week. Sleep is the first thing to protect.");
  return { alerts, tips };
}

// ---------------------------------------------------------------------------
// Injury-prevention warm-ups (our own routines, by age)
// ---------------------------------------------------------------------------

export interface WarmupRoutine {
  id: string;
  name: string;
  minutes: number;
  why: string;
  parts: { name: string; minutes: number; moves: string[] }[];
}

const KIDS_WARMUP: WarmupRoutine = {
  id: "kids", name: "Game-style warm-up", minutes: 10,
  why: "Young players learn landing, balance and changing direction best through games.",
  parts: [
    { name: "Move", minutes: 3, moves: ["Jog with the ball, then skip, side-step and run backwards", "Freeze tag: when tagged, balance on one foot for 5 seconds"] },
    { name: "Land and balance", minutes: 3, moves: ["Jump and 'stick' the landing, knees soft and over the toes, 5 times", "Stand on one foot and pass the ball back and forth with a partner, 30 seconds each foot"] },
    { name: "Quick feet", minutes: 4, moves: ["Red light, green light with the ball", "Short sprints to a cone and back, changing direction"] },
  ],
};

const TEEN_WARMUP: WarmupRoutine = {
  id: "teen", name: "Injury-prevention warm-up", minutes: 18,
  why: "A warm-up with strength, balance and landing work, done at least twice a week, cuts knee and ankle injuries.",
  parts: [
    { name: "Running prep", minutes: 6, moves: ["Easy jog, 2 lengths", "Open and close the hip while jogging", "Side shuffles and crossovers", "Shoulder-to-shoulder bumps with a partner, jumping sideways", "Quick forward and back runs"] },
    { name: "Strength and balance", minutes: 8, moves: ["Front plank, 3 x 20 seconds", "Side plank, 2 x 15 seconds each side", "Hamstring lowers with a partner holding ankles, 3 to 5 slow reps", "Single-leg stance, pass a ball, 30 seconds each leg", "Squats with knees tracking over toes, 10 slow reps", "Jumps: land soft and quiet, knees never caving in, 10 reps"] },
    { name: "Speed", minutes: 4, moves: ["Build-up runs to 80% speed, 2 lengths", "Bounding strides", "Plant and cut drills at game speed, 4 each side"] },
  ],
};

const ADULT_WARMUP: WarmupRoutine = {
  ...TEEN_WARMUP, id: "adult", name: "Injury-prevention warm-up", minutes: 20,
  why: "Adults lose muscle and tendon elasticity. A full warm-up with hamstring and groin work protects the most common soccer injuries.",
  parts: [
    ...TEEN_WARMUP.parts.slice(0, 2),
    { name: "Groin and calves", minutes: 3, moves: ["Side-lying adductor squeezes, 10 each side", "Calf raises, 15 slow reps each leg"] },
    TEEN_WARMUP.parts[2],
  ],
};

export function warmupFor(profile: AthleteProfile): WarmupRoutine & { extra: string[] } {
  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const base = (age ?? 20) < 11 ? KIDS_WARMUP : (age ?? 20) < 25 ? TEEN_WARMUP : ADULT_WARMUP;
  const extra: string[] = [];
  if (band.warmupMin > base.minutes) extra.push(`Your program calls for ${band.warmupMin} minutes before games. Add easy jogging and ball work to fill the time.`);
  extra.push(...asthmaPlan(profile).slice(0, 1));
  return { ...base, extra };
}

// ---------------------------------------------------------------------------
// Sick-day rule
// ---------------------------------------------------------------------------

export function sickDay(ci: DailyCheckIn | null | undefined): HealthAlert | null {
  if (!ci) return null;
  if (ci.fever) return { id: "sick:fever", level: "stop", title: "Fever: no training today", detail: "Training with a fever can hurt the heart and makes illness last longer. Rest, drink plenty, and wait 24 hours with no fever (without fever medicine) before training again.", audience: ["player", "parent", "coach"] };
  if (ci.sick) return { id: "sick", level: "warn", title: "Sick today", detail: "Cold symptoms above the neck only (runny nose, sore throat): easy training is usually OK. Chest symptoms, vomiting, diarrhea or body aches: rest. Stay home from team events if you might be contagious.", audience: ["player", "parent"] };
  return null;
}

// ---------------------------------------------------------------------------
// Overuse guard: hours per week, rest days, double-booking
// ---------------------------------------------------------------------------

export interface LoadGuard {
  weekHours: number;
  maxHours: number | null;
  restDays: number;
  sessions: number;
  doubleBooked: { date: string; detail: string }[];
  alerts: HealthAlert[];
}

/**
 * Youth guidance: organized hours per week no more than the child's age,
 * at least 1 to 2 days fully off each week, and time off each year.
 * Looks at the 7 days starting `from`.
 */
export function loadGuard(profile: AthleteProfile, from: string): LoadGuard {
  const age = effectiveAge(profile.identity);
  const end = addDays(from, 6);
  const evs = sortedEvents(profile).filter((e) => (e.type === "match" || e.type === "training" || e.type === "tournament") && eventDate(e) >= from && eventDate(e) <= end);
  const minutes = evs.reduce((a, e) => a + durationOf(profile, e), 0);
  const weekHours = r1(minutes / 60);
  const busy = new Set(evs.map(eventDate));
  const restDays = 7 - busy.size;
  const maxHours = age !== undefined && age < 19 ? age : null;
  const alerts: HealthAlert[] = [];
  const doubleBooked: LoadGuard["doubleBooked"] = [];
  const practice = routineOf(profile).practice;
  const byDay = new Map<string, typeof evs>();
  for (const e of evs) { const d = eventDate(e); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(e); }
  for (const [d, list] of byDay) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const aEnd = toMin(eventTime(a, practice)) + durationOf(profile, a);
      const bStart = toMin(eventTime(b, practice));
      if (bStart < aEnd) doubleBooked.push({ date: d, detail: `${a.title || a.type} and ${b.title || b.type} overlap at ${to12(fromMin(bStart))}.` });
      else if (a.type === "match" && b.type === "match" && !list.some((x) => x.type === "tournament"))
        doubleBooked.push({ date: d, detail: `Two games on the same day (${to12(eventTime(a, practice))} and ${to12(eventTime(b, practice))}).` });
    }
  }
  if (maxHours !== null && weekHours > maxHours)
    alerts.push({ id: "load:hours", level: "warn", title: `${weekHours} hours of soccer this week`, detail: `A common guideline for young athletes is no more hours of organized sport a week than their age (${maxHours}). More than that raises overuse injury and burnout risk. Consider skipping an optional session.`, audience: ["player", "parent"] });
  if (restDays < 1)
    alerts.push({ id: "load:rest", level: "warn", title: "No day off this week", detail: "Every week needs at least one full day off, ideally two for young players. Growing bodies repair on rest days.", audience: ["player", "parent"] });
  for (const d of doubleBooked)
    alerts.push({ id: `load:double:${d.date}`, level: "info", title: `Schedule clash on ${d.date}`, detail: d.detail + " Check with both coaches, and plan an extra snack and fluids.", audience: ["player", "parent"] });
  return { weekHours, maxHours, restDays, sessions: evs.length, doubleBooked, alerts };
}

// ---------------------------------------------------------------------------
// Heat acclimatization (first 14 days of preseason)
// ---------------------------------------------------------------------------

export function acclimatization(profile: AthleteProfile, date: string): { day: number; rules: string[] } | null {
  const start = profile.schedule?.preseasonStart;
  if (!start) return null;
  const day = daysBetween(start, date) + 1;
  if (day < 1 || day > 14) return null;
  const rules: string[] = [];
  if (day <= 5) {
    rules.push("Days 1 to 5: one practice a day, no longer than 3 hours including warm-up and cool-down.");
    rules.push("Build up slowly. The body takes about 2 weeks to handle heat well.");
  } else {
    rules.push(`Day ${day} of 14: two-a-days are OK only with at least 3 hours of rest in a cool place between them.`);
    rules.push("After a two-a-day, the next day is a single, lighter practice.");
  }
  rules.push("Weigh in before and after practice. Drink back 1.5 times what you lose.");
  return { day, rules };
}

// ---------------------------------------------------------------------------
// Under-fueling signals (quiet, parent-only)
// ---------------------------------------------------------------------------

export function fuelingAlerts(profile: AthleteProfile, checkins: DailyCheckIn[], today: string): HealthAlert[] {
  const age = effectiveAge(profile.identity);
  const out: HealthAlert[] = [];
  const hist = [...(profile.anthropometrics.massHistory || [])].filter((m) => m.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const recent = hist.filter((m) => daysBetween(m.date, today) <= 45);
  let drop = 0;
  if (recent.length >= 2) drop = (recent[0].bodyMassKg - recent[recent.length - 1].bodyMassKg) / recent[0].bodyMassKg;
  const twoWeeks = lastN(checkins, today, 14);
  const lowEnergy = twoWeeks.filter((c) => (c.energyLevel ?? 10) <= 3).length;
  const young = age !== undefined && age < 19;
  if (young && drop >= 0.05) {
    out.push({ id: "fuel:weightdrop", level: "warn", title: "Weight dropped quickly", detail: `Weight is down about ${Math.round(drop * 100)}% in the last 6 weeks. Growing athletes should not be losing weight. Add a snack on training days and check in with a pediatrician. Keep the talk about fuel and energy, not weight or looks.`, audience: ["parent"] });
  }
  if (lowEnergy >= 5) {
    out.push({ id: "fuel:energy", level: "info", title: "Low energy on many days", detail: "Often a sign of not eating enough for the training load, or not enough sleep. Try a bigger breakfast and a snack before practice.", audience: young ? ["parent", "player"] : ["player"] });
  }
  return out;
}

/** No weight-loss or body-shape language for kids and teens, anywhere. */
export function bodyImageSafeGoals(profile: AthleteProfile): string[] {
  const age = effectiveAge(profile.identity);
  const goals = profile.goals?.goals || [];
  if (age !== undefined && age < 18) return goals.filter((g) => g !== "lose_weight");
  return goals;
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

export interface HealthStatus {
  date: string;
  firstName: string;
  parentVoice: boolean;
  alerts: HealthAlert[];
  concussion: ConcussionStatus;
  dangerSigns: string[];
  returnSteps: typeof RETURN_STEPS;
  urine: ReturnType<typeof urineAdvice>;
  sweat: { rateLph?: number; tests: SweatTest[]; advice: string[] };
  growth: GrowthStatus | null;
  asthma: string[];
  cycle: CycleStatus | null;
  wellbeing: { tips: string[]; breathing: { id: string; name: string; minutes: number; steps: string[]; when: string }[]; support: Partial<typeof SUPPORT> };
  warmup: ReturnType<typeof warmupFor>;
  load: LoadGuard;
  acclimatization: ReturnType<typeof acclimatization>;
  /** Hide body weight on screens for players under 18. */
  hideWeight: boolean;
  features: FeatureSet;
}

const LEVEL: Record<AlertLevel, number> = { stop: 0, warn: 1, info: 2 };

export function buildHealthStatus(
  profile: AthleteProfile,
  checkins: DailyCheckIn[],
  today: string,
  opts: { viewer?: "player" | "parent" | "coach" } = {},
): HealthStatus {
  const age = effectiveAge(profile.identity);
  const f = featuresFor(profile);
  const on = f.on;
  const ci = checkins.find((c) => c.date === today) || null;
  const concussion = concussionStatus(profile, today, ci);
  const alerts: HealthAlert[] = [];
  if (concussion.active)
    alerts.push({ id: "concussion", level: "stop", title: "Not cleared to play", detail: concussion.message, audience: ["player", "parent", "coach"] });
  if (ci?.headSymptoms && !concussion.active)
    alerts.push({ id: "head", level: "stop", title: "Head symptoms after a hit?", detail: "If this followed a hit to the head or body: no more play today. Report it in the app so we start the return-to-play steps, and see a doctor. Call 911 for any danger sign.", audience: ["player", "parent", "coach"] });
  const sick = sickDay(ci);
  if (sick) alerts.push(sick);
  if (on.sorenessMap) alerts.push(...sorenessAlerts(checkins, today, age));
  const cyc = on.cycle ? cycleStatus(profile, checkins, today) : null;
  if (cyc?.alert) alerts.push(cyc.alert);
  const wb = on.burnoutCheck ? wellbeing(profile, checkins, today) : { alerts: [], tips: [] };
  alerts.push(...wb.alerts);
  if (on.fuelingAlerts) alerts.push(...fuelingAlerts(profile, checkins, today));
  const load = loadGuard(profile, today);
  // Hour and rest-day limits are for growing players; clashes matter for everyone.
  alerts.push(...load.alerts.filter((a) => on.overuseGuard || a.id.startsWith("load:double")));
  const growth = on.growth ? growthStatus(profile, today) : null;
  if (growth?.spurt) alerts.push({ id: "growth", level: "info", title: "Growth spurt", detail: growth.advice[0], audience: ["player", "parent"] });
  if (ci?.inhalerUsed) alerts.push({ id: "asthma:used", level: "info", title: "Needed the inhaler today", detail: "If the rescue inhaler is needed more than twice a week, tell the doctor. The asthma plan may need a change.", audience: ["player", "parent"] });
  const urine = on.urineColor ? urineAdvice(ci?.urineColor) : null;
  if (urine && urine.status === "dehydrated") alerts.push({ id: "urine", level: "warn", title: "Dehydrated", detail: urine.text, audience: ["player", "parent"] });

  const viewer = opts.viewer || (parentVoice(age) ? "parent" : "player");
  const visible = alerts.filter((a) => a.audience.includes(viewer) || (viewer === "parent" && a.audience.includes("player")));
  visible.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);

  const tests = on.sweatTest ? profile.advanced?.sweatTests || [] : [];
  const lastTest = tests[tests.length - 1];
  const young = (age ?? 18) < 10;
  return {
    date: today,
    firstName: firstName(profile),
    parentVoice: parentVoice(age),
    alerts: visible,
    concussion,
    dangerSigns: DANGER_SIGNS,
    returnSteps: RETURN_STEPS,
    urine,
    sweat: { rateLph: on.sweatTest ? profile.advanced?.sweatRateLitresPerHour : undefined, tests, advice: lastTest ? sweatAdvice(lastTest, age) : [] },
    growth,
    asthma: asthmaPlan(profile),
    cycle: cyc,
    wellbeing: {
      tips: wb.tips,
      breathing: young ? KID_BREATHING : BREATHING,
      support: on.crisisLine || viewer === "parent" ? SUPPORT : { talk: "If something is bothering you, tell a grown-up you trust: a parent, coach or teacher." },
    },
    warmup: warmupFor(profile),
    load: on.overuseGuard ? load : { ...load, maxHours: null },
    acclimatization: on.heatAcclimatization ? acclimatization(profile, today) : null,
    hideWeight: !on.bodyWeight,
    features: f,
  };
}

/** Minimum a coach sees for a rostered player. */
export function coachFlags(profile: AthleteProfile, today: string, ci?: DailyCheckIn | null): string[] {
  const out: string[] = [];
  if (activeConcussion(profile)) out.push("Not cleared to play (concussion protocol)");
  if (ci?.fever) out.push("Out sick today");
  if ((profile.nutrition.allergies || []).some((a) => a.epinephrine)) out.push("Carries an EpiPen");
  if (profile.health?.asthma?.has) out.push("Asthma: inhaler in bag");
  return out;
}
