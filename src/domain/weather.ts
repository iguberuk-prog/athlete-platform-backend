/**
 * Weather-driven adjustments (pure).
 *
 * The server looks up the forecast for the ZIP code of every game and practice
 * (or the athlete's home ZIP) and hands hourly data to these functions, which
 * turn it into concrete changes to the plan.
 *
 * HEAT uses WBGT (wet-bulb globe temperature: heat + humidity + sun + wind),
 * the measure sports-medicine groups and state associations use. Flags follow
 * the NJSIAA heat participation policy (WBGT, °F):
 *
 *   green  < 80      normal, 3 rest breaks an hour
 *   yellow 80-85     caution, 3 breaks of 4+ min an hour
 *   orange 85.1-88   max 2 h practice, 4 breaks of 4+ min an hour
 *   red    88.1-90   max 1 h practice, 20 min of breaks an hour
 *   black  > 90      no outdoor workouts
 *
 * The athlete's league or school policy always wins; the app says so.
 *
 * COLD uses the "feels like" temperature (wind chill), °F:
 *
 *   cool       40-50   layers until kickoff
 *   cold       25-40   longer warm-up, warm drink at half-time, a little more fuel
 *   very_cold  10-25   cover head and hands, warm snack, more fuel
 *   extreme    < 10    frostbite risk rises; follow league policy, limit exposure
 *
 * Fueling changes follow published sports-nutrition guidance (pre-hydrate
 * about 5-7 ml/kg 4 h before; more fluid and sodium in heat; energy needs rise
 * modestly in cold, and thirst is blunted so drinking must be planned).
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { eventDate, eventTime, eventsOn, routineOf, shiftLocal } from "./dates.js";

export interface WeatherHour {
  /** Local wall-clock hour at the location, "YYYY-MM-DDTHH:00". */
  time: string;
  tempF: number | null;
  feelsF: number | null;
  humidity: number | null;
  wbgtF: number | null;
  windMph: number | null;
  precipPct: number | null;
}

export type HeatFlag = "green" | "yellow" | "orange" | "red" | "black";
export type ColdLevel = "none" | "cool" | "cold" | "very_cold" | "extreme";

export interface Conditions {
  zip: string;
  place?: string;
  from: string; // local time window start
  to: string;
  tempF: [number, number] | null;
  feelsF: [number, number] | null;
  maxWbgtF: number | null;
  humidity: number | null;
  windMph: number | null;
  rainChance: number | null;
  heat: HeatFlag | null;
  cold: ColdLevel;
  /** One line for the UI: "88°F, feels 96°F · Heat flag: orange". */
  headline: string;
}

export interface WeatherPlan {
  conditions: Conditions;
  severity: "none" | "moderate" | "high" | "extreme";
  /** Extra fluid across the day, litres. */
  extraFluidL: number;
  /** Extra carbohydrate, g/kg for the day. */
  extraCarbsPerKg: number;
  /** Fluid to drink ~4 h before the event, ml. */
  preHydrateMl: number;
  /** In-play fluid target, litres per hour. */
  inGameLph: [number, number];
  actions: string[];
  packing: string[];
  warnings: string[];
  /** Food roles to lean on (for pickers): "cooling" or "warm". */
  foodRole: "cooling" | "warm" | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r10 = (n: number) => Math.round(n / 10) * 10;
export const cups = (ml: number) => { const n = Math.max(1, Math.round(ml / 237)); return `${n} cup${n === 1 ? "" : "s"}`; };

export function heatFlag(wbgtF: number | null): HeatFlag | null {
  if (wbgtF === null || !Number.isFinite(wbgtF)) return null;
  if (wbgtF > 90) return "black";
  if (wbgtF > 88) return "red";
  if (wbgtF > 85) return "orange";
  if (wbgtF >= 80) return "yellow";
  return "green";
}

export function coldLevel(feelsF: number | null): ColdLevel {
  if (feelsF === null || !Number.isFinite(feelsF)) return "none";
  if (feelsF < 10) return "extreme";
  if (feelsF < 25) return "very_cold";
  if (feelsF < 40) return "cold";
  if (feelsF <= 50) return "cool";
  return "none";
}

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

/** Summarize the hours between `from` and `to` (local "YYYY-MM-DDTHH:MM"). */
export function summarize(zip: string, hours: WeatherHour[], from: string, to: string, place?: string): Conditions | null {
  const fromH = from.slice(0, 13);
  const toH = to.slice(0, 13);
  const win = hours.filter((h) => h.time.slice(0, 13) >= fromH && h.time.slice(0, 13) <= toH);
  if (!win.length) return null;
  const t = nums(win.map((h) => h.tempF));
  const f = nums(win.map((h) => h.feelsF ?? h.tempF));
  const w = nums(win.map((h) => h.wbgtF));
  const hum = nums(win.map((h) => h.humidity));
  const wind = nums(win.map((h) => h.windMph));
  const rain = nums(win.map((h) => h.precipPct));
  const maxW = w.length ? Math.max(...w) : null;
  const minFeels = f.length ? Math.min(...f) : null;
  const heat = heatFlag(maxW);
  const cold = coldLevel(minFeels);
  const tempF: [number, number] | null = t.length ? [Math.round(Math.min(...t)), Math.round(Math.max(...t))] : null;
  const feelsF: [number, number] | null = f.length ? [Math.round(Math.min(...f)), Math.round(Math.max(...f))] : null;
  const rainChance = rain.length ? Math.max(...rain) : null;
  const bits: string[] = [];
  if (tempF) bits.push(tempF[0] === tempF[1] ? `${tempF[1]}°F` : `${tempF[0]}-${tempF[1]}°F`);
  if (feelsF && tempF && Math.abs(feelsF[1] - tempF[1]) >= 3 && heat && heat !== "green") bits.push(`feels ${feelsF[1]}°F`);
  if (feelsF && tempF && Math.abs(feelsF[0] - tempF[0]) >= 3 && cold !== "none") bits.push(`feels ${feelsF[0]}°F`);
  if (rainChance !== null && rainChance >= 40) bits.push(`${Math.round(rainChance)}% rain`);
  let tag = "";
  if (heat && heat !== "green") tag = ` · Heat flag: ${heat}`;
  else if (cold !== "none") tag = ` · ${cold === "very_cold" ? "Very cold" : cold === "extreme" ? "Extreme cold" : cold === "cold" ? "Cold" : "Cool"}`;
  return {
    zip, place, from, to, tempF, feelsF, maxWbgtF: maxW === null ? null : r1(maxW),
    humidity: hum.length ? Math.round(Math.max(...hum)) : null,
    windMph: wind.length ? Math.round(Math.max(...wind)) : null,
    rainChance, heat, cold,
    headline: bits.join(", ") + tag,
  };
}

/**
 * Turn conditions into plan changes for one event (or one day).
 * `kid` = under 13 (advice is written for the parent), `M` = body mass kg,
 * `durationMin` = time exposed (game or practice length).
 */
export function weatherPlan(c: Conditions, opts: { M: number; kid: boolean; young: boolean; durationMin: number; name?: string }): WeatherPlan {
  const { M, kid, young } = opts;
  const hrs = Math.max(0.5, opts.durationMin / 60);
  const actions: string[] = [];
  const packing: string[] = [];
  const warnings: string[] = [];
  let severity: WeatherPlan["severity"] = "none";
  let extraFluidL = 0;
  let extraCarbsPerKg = 0;
  let preHydrateMl = r10(5 * M);
  let inGame: [number, number] = young ? [0.3, 0.5] : [0.4, 0.8];
  let foodRole: WeatherPlan["foodRole"] = null;

  switch (c.heat) {
    case "yellow":
      severity = "moderate";
      extraFluidL = r1(0.25 * hrs + 0.3);
      preHydrateMl = r10(6 * M);
      inGame = young ? [0.4, 0.6] : [0.6, 0.9];
      actions.push(`Warm and humid: drink about ${preHydrateMl} ml (${cups(preHydrateMl)}) 4 hours before, and sip at every break.`);
      actions.push("Light-colored, loose clothing. Sunscreen. Shade during breaks.");
      packing.push("An extra water bottle", "Sunscreen");
      foodRole = "cooling";
      break;
    case "orange":
      severity = "high";
      extraFluidL = r1(0.5 * hrs + 0.4);
      preHydrateMl = r10(7 * M);
      inGame = young ? [0.5, 0.7] : [0.8, 1.0];
      actions.push(`Hot: drink about ${preHydrateMl} ml (${cups(preHydrateMl)}) 4 hours before, then another cup 15 minutes before warm-up.`);
      actions.push(young ? "Water at every break, plus a sports drink because of the heat." : "Add electrolytes: a sports drink or electrolyte tabs, not just water. Salty snacks with meals.");
      actions.push("Pre-cool: a cold drink or freeze pop 30 minutes before, and cold towels at half-time.");
      actions.push("Heat can kill appetite. Keep the pre-game meal smaller and easy, and don't skip it.");
      packing.push("Two extra bottles, one frozen overnight", "Cold towel in a cooler", young ? "Sports drink" : "Electrolyte tabs");
      warnings.push(kid ? "Check with the coach: many leagues shorten play or add water breaks in this heat." : "NJ high school heat policy caps practice at 2 hours at this level. Your league's policy decides.");
      foodRole = "cooling";
      break;
    case "red":
      severity = "extreme";
      extraFluidL = r1(0.75 * hrs + 0.5);
      preHydrateMl = r10(7 * M);
      inGame = young ? [0.5, 0.8] : [0.8, 1.2];
      actions.push(`Very hot: drink about ${preHydrateMl} ml 4 hours before and keep sipping. Electrolytes at every break.`);
      actions.push("Pre-cool with an ice slushie 30 minutes before. Cold towels and shade at every stoppage.");
      actions.push(`Weigh ${kid ? "them" : "yourself"} before and after: drink 1.5 times the weight lost over the next few hours.`);
      packing.push("Cooler with ice, cold towels and extra drinks", "Electrolytes", "Hat for breaks");
      warnings.push(kid ? "Very hot. Check with the coach or league before the game: many pause or shorten play at this level." : "NJ high school heat policy: at this level practice is limited to 1 hour with 20 minutes of breaks. Check with the coach or league before the game.");
      foodRole = "cooling";
      break;
    case "black":
      severity = "extreme";
      extraFluidL = r1(0.75 * hrs + 0.5);
      preHydrateMl = r10(7 * M);
      inGame = young ? [0.5, 0.8] : [0.8, 1.2];
      warnings.push("Dangerous heat. NJ high school heat policy calls for NO outdoor workouts at this level. Expect a delay or cancellation, and check with the coach or league.");
      actions.push("If play goes ahead: pre-cool with an ice slushie, electrolytes every break, cold towels and shade at every stoppage.");
      packing.push("Cooler with ice, cold towels and extra drinks", "Electrolytes");
      foodRole = "cooling";
      break;
  }
  if (c.heat && c.heat !== "green") {
    warnings.push(`Heat illness signs: confusion, dizziness, vomiting, hot skin, or ${kid ? "your athlete" : "a teammate"} stops making sense. Stop, cool them in cold water right away, and call 911.`);
  }

  if (c.cold !== "none" && severity !== "extreme") {
    switch (c.cold) {
      case "cool":
        actions.push(`Cool out: keep a warm layer on until kickoff and put it back on at half-time.`);
        packing.push("A warm layer for before and after");
        break;
      case "cold":
        severity = severity === "none" ? "moderate" : severity;
        extraCarbsPerKg = 0.5;
        actions.push("Cold: the body burns a little more fuel keeping warm. Add a carb snack today.");
        actions.push("Warm up 5 minutes longer, and keep moving until kickoff.");
        actions.push(`A warm drink at half-time. ${kid ? "Kids" : "People"} drink less in the cold without noticing, so keep sipping.`);
        actions.push("Get into dry, warm clothes within 10 minutes after, then a warm recovery meal.");
        packing.push("Base layer, gloves and a hat", "Thermos with a warm drink", "Dry clothes for after");
        foodRole = "warm";
        break;
      case "very_cold":
        severity = "high";
        extraCarbsPerKg = 0.75;
        actions.push("Very cold: more fuel today. A bigger breakfast and a carb snack before and after.");
        actions.push("Warm up 10 minutes longer. Cover head, hands and ears. Limit standing around.");
        actions.push("Warm drink and a warm snack at half-time. Keep drinking even if you don't feel thirsty.");
        actions.push("Dry clothes immediately after, then a hot meal.");
        packing.push("Thermal base layer, gloves, hat, neck gaiter", "Thermos with a warm drink", "Dry clothes and a blanket for the bench");
        foodRole = "warm";
        break;
      case "extreme":
        severity = "extreme";
        extraCarbsPerKg = 0.75;
        warnings.push(`Extreme cold: frostbite can start on exposed skin. Follow the league's cold-weather policy. ${kid ? "Keep them" : "Stay"} covered and warm between shifts.`);
        actions.push("Cover all exposed skin, warm drinks at every break, and get indoors quickly after.");
        packing.push("Full thermal layers, gloves, hat, face cover", "Hand warmers", "Thermos with a warm drink");
        foodRole = "warm";
        break;
    }
    if (c.cold !== "cool") warnings.push("Cold signs to watch: uncontrollable shivering, numb or white fingers or ears, clumsiness. Get warm and dry right away.");
  }
  if ((c.rainChance ?? 0) >= 50 && c.cold !== "none") {
    actions.push("Rain plus cold drains heat fast: pack a spare dry shirt and socks for half-time.");
    packing.push("Spare dry shirt and socks");
  }

  return { conditions: c, severity, extraFluidL, extraCarbsPerKg, preHydrateMl, inGameLph: inGame, actions, packing, warnings, foodRole };
}

/** Hourly forecasts keyed by ZIP code, plus place names. */
export interface WeatherIndex {
  byZip: Record<string, { place?: string; hours: WeatherHour[] }>;
}

export function hoursFor(wx: WeatherIndex | undefined, zip: string | undefined) {
  if (!wx || !zip) return null;
  return wx.byZip[zip] || null;
}

// ---------------------------------------------------------------------------
// Matching forecasts to the athlete's schedule
// ---------------------------------------------------------------------------


export const durationOf = (profile: AthleteProfile, e: ScheduledEvent) =>
  e.type === "match" ? 110 : profile.training?.avgSessionMinutes || 90;

export function zipFor(profile: AthleteProfile, e?: ScheduledEvent): string | undefined {
  return e?.zip || profile.routine?.homeZip;
}

/** Conditions during one game or practice (null when no forecast covers it). */
export function eventConditions(profile: AthleteProfile, e: ScheduledEvent, wx?: WeatherIndex): Conditions | null {
  const zip = zipFor(profile, e);
  const f = hoursFor(wx, zip);
  if (!f || !zip) return null;
  const start = `${eventDate(e)}T${eventTime(e, routineOf(profile).practice)}`;
  return summarize(zip, f.hours, start, shiftLocal(eventDate(e), eventTime(e, routineOf(profile).practice), durationOf(profile, e)), f.place);
}

export function planOptsFor(profile: AthleteProfile, durationMin: number) {
  const age = effectiveAge(profile.identity);
  return {
    M: profile.anthropometrics.bodyMassKg,
    kid: age !== undefined && age < 13,
    young: age !== undefined && age < 15,
    durationMin,
    name: (profile.identity.fullName || "").trim().split(/\s+/)[0],
  };
}

export function eventWeatherPlan(profile: AthleteProfile, e: ScheduledEvent, wx?: WeatherIndex): WeatherPlan | null {
  const c = eventConditions(profile, e, wx);
  return c ? weatherPlan(c, planOptsFor(profile, durationOf(profile, e))) : null;
}

const RANK: Record<WeatherPlan["severity"], number> = { none: 0, moderate: 1, high: 2, extreme: 3 };

/**
 * The day's weather plan: the worst of the day's games and practices, or,
 * on a day with nothing scheduled, the afternoon at the home ZIP.
 */
export function dayWeatherPlan(profile: AthleteProfile, date: string, wx?: WeatherIndex): WeatherPlan | null {
  const events = eventsOn(profile, date).filter((e) => e.type === "match" || e.type === "training");
  const plans = events.map((e) => eventWeatherPlan(profile, e, wx)).filter((p): p is WeatherPlan => !!p);
  if (plans.length) return plans.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.extraFluidL - a.extraFluidL)[0];
  const zip = profile.routine?.homeZip;
  const f = hoursFor(wx, zip);
  if (!f || !zip) return null;
  const c = summarize(zip, f.hours, `${date}T12:00`, `${date}T18:00`, f.place);
  if (!c) return null;
  const p = weatherPlan(c, planOptsFor(profile, 60));
  // A rest day only needs the fluid part, softened.
  return { ...p, extraFluidL: Math.round(p.extraFluidL * 5) / 10, extraCarbsPerKg: 0 };
}

/** Every ZIP the schedule touches from `from` for `days` days (plus home). */
export function zipsNeeded(profile: AthleteProfile, from: string, days: number): string[] {
  const out = new Set<string>();
  if (profile.routine?.homeZip) out.add(profile.routine.homeZip);
  const end = shiftLocal(from, "00:00", days * 1440).slice(0, 10);
  for (const e of profile.schedule?.events || []) {
    const d = eventDate(e);
    if (d >= from && d <= end && e.zip) out.add(e.zip);
  }
  return [...out];
}
