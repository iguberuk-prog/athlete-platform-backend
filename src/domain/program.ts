/**
 * "My program": the athlete's age program, personalized with their numbers,
 * plus the food-safety summary. Pure.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { AGE_BANDS, bandForAge, parentVoice, sleepHoursFor, type AgeBand } from "./ageBands.js";
import { routineOf, toMin, fromMin, to12 } from "./dates.js";
import { fillText, safetyContext, safetySummary } from "./foods.js";

export interface Program {
  profileId: string;
  firstName: string;
  age: number | null;
  band: AgeBand;
  parentVoice: boolean;
  numbers: {
    proteinPerDayG: [number, number];
    proteinPerMealG: number;
    proteinPerMealText: string;
    fluidsBaseL: number;
    sleepHours: [number, number];
    bedtimeForWake: string;
    wake: string;
    warmupMin: number;
  };
  rules: { caffeine: string; inGame: string; gels: string; supplements: string };
  nextProgram: { name: string; ages: string; atAge: number } | null;
  safety: ReturnType<typeof safetySummary>;
  allPrograms: { id: string; name: string; ages: string; tagline: string; current: boolean }[];
  disclaimer: string;
}

const r5 = (n: number) => Math.round(n / 5) * 5;

export function buildProgram(profile: AthleteProfile): Program {
  const age = effectiveAge(profile.identity);
  const base = bandForAge(age);
  const c = safetyContext(profile);
  const f = (xs: string[]) => xs.map((x) => fillText(x, c));
  const band: AgeBand = { ...base, focus: f(base.focus), fuel: f(base.fuel), hydration: f(base.hydration), sleep: f(base.sleep), recovery: f(base.recovery), supplements: f(base.supplements) };
  const M = profile.anthropometrics.bodyMassKg;
  const [sLo, sHi] = sleepHoursFor(age);
  const { wake } = routineOf(profile);
  // Bedtime that gives the upper-middle of the sleep range before the usual wake time.
  const target = Math.round(((sLo + sHi) / 2) * 60);
  const bedtime = fromMin(Math.round((toMin(wake) - target - 15) / 15) * 15);
  const idx = AGE_BANDS.indexOf(base);
  const next = AGE_BANDS[idx + 1];

  return {
    profileId: profile.id,
    firstName: (profile.identity.fullName || "").trim().split(/\s+/)[0] || "Athlete",
    age: age ?? null,
    band,
    parentVoice: parentVoice(age),
    numbers: {
      proteinPerDayG: [r5(band.proteinPerKg[0] * M), r5(band.proteinPerKg[1] * M)],
      proteinPerMealG: Math.round(band.perMealProteinPerKg * M),
      proteinPerMealText: base.targetsMode === "plates" ? "a palm-size portion" : `${Math.round(band.perMealProteinPerKg * M)}-${Math.round((band.perMealProteinPerKg + 0.1) * M)} g`,
      fluidsBaseL: Math.round((band.fluidMlPerKg / 1000) * M * 10) / 10,
      sleepHours: [sLo, sHi],
      bedtimeForWake: to12(bedtime),
      wake: to12(wake),
      warmupMin: band.warmupMin,
    },
    rules: {
      caffeine: band.caffeine === "none" ? "No caffeine or energy drinks." : band.caffeine === "avoid" ? "Avoid caffeine and energy drinks under 18." : "Optional: about 3 mg/kg 60 minutes before games, never within 8 hours of bed.",
      inGame: band.inGame === "water_fruit" ? "Water, plus fruit at half-time. Sports drink only in heat or games over an hour." : "Sports drink and gels, 30-60 g carbs per hour of play.",
      gels: band.allowGels ? "Allowed (caffeine-free under 18)." : "Not needed at this age.",
      supplements: band.supplements[0],
    },
    nextProgram: next && age !== undefined ? { name: next.name, ages: next.ages, atAge: next.min } : null,
    safety: safetySummary(profile),
    allPrograms: AGE_BANDS.map((b) => ({ id: b.id, name: b.name, ages: b.ages, tagline: b.tagline, current: b.id === band.id })),
    disclaimer: "General sports-nutrition and sleep education based on published guidance for each age group. Not medical advice. Athletes with medical conditions should follow their doctor or dietitian.",
  };
}
