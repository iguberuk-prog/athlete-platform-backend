/**
 * Day classification + daily targets + the "Today" summary (pure).
 *
 * Every day falls into one type, and the type sets the fueling targets:
 *
 *   match      game today                      carbs 6-8 g/kg
 *   match_eve  game tomorrow                   carbs 6-8 g/kg (top up glycogen)
 *   recovery   game yesterday                  carbs 6-10 g/kg if another game within 3 days, else 5-7
 *   training   practice today                  carbs 5-7 g/kg
 *   rest       nothing scheduled               carbs 3-5 g/kg
 *
 * Protein sits at 1.5-2.0 g/kg every day. Fluids start from ~35 ml/kg plus
 * ~0.75 L per hour of training. These follow published sports-nutrition
 * ranges and are starting points, not individual medical advice.
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { computeReadiness, type Readiness } from "./readiness.js";
import { bandForAge, parentVoice, sleepHoursFor, type BandId, type TargetsMode } from "./ageBands.js";
import { effectiveAge } from "./profile.js";
import { examples, fillText, safetyContext } from "./foods.js";
import { dayWeatherPlan, eventWeatherPlan, type WeatherIndex, type WeatherPlan } from "./weather.js";
import {
  addDays,
  daysBetween,
  eventDate,
  eventTime,
  eventsOn,
  routineOf,
  sortedEvents,
  to12,
  toMin,
  fromMin,
} from "./dates.js";

export type DayType = "match" | "match_eve" | "recovery" | "training" | "rest";

export interface DailyTargets {
  /** How the app should present targets for this age: plates, a gram guide, or grams. */
  mode: TargetsMode;
  /** Plate guidance (always present; the main display for young kids). */
  plate: string;
  carbsG: [number, number];
  carbsPerKg: [number, number];
  proteinG: [number, number];
  fluidsL: number;
  note: string;
}

export interface EventRef {
  type: string;
  date: string;
  time: string;
  conditions?: string;
  daysAway: number;
}

export interface TodaySummary {
  profileId: string;
  date: string;
  firstName: string;
  dayType: DayType;
  headline: string;
  focus: string[];
  todaysEvents: EventRef[];
  nextMatch: EventRef | null;
  targets: DailyTargets;
  readiness: Readiness | null;
  checkedIn: boolean;
  tournament: boolean;
  program: { id: BandId; name: string; ages: string; tagline: string; sleepHours: [number, number]; parentVoice: boolean };
  /** Forecast-driven plan for today (null when no ZIP or no forecast). */
  weather: { day: WeatherPlan | null; events: { type: string; time: string; plan: WeatherPlan }[]; tomorrow: { time: string; plan: WeatherPlan }[]; homeZip: string | null };
  /** Food-safety items for the Today card. */
  safety: { confirmed: boolean; epinephrine: boolean; medicalDiets: string[] };
  disclaimer: string;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

function ref(e: ScheduledEvent, from: string): EventRef {
  const date = eventDate(e);
  return {
    type: e.type,
    date,
    time: eventTime(e),
    conditions: e.conditions,
    daysAway: daysBetween(from, date),
  };
}

/** Next match on or after `date` (and after `afterTime` on that same day). */
export function nextMatchFrom(profile: AthleteProfile, date: string): ScheduledEvent | null {
  return sortedEvents(profile).find((e) => e.type === "match" && eventDate(e) >= date) || null;
}

/** True when two or more matches fall within 48 hours of each other around this date. */
export function inTournament(profile: AthleteProfile, date: string): boolean {
  const matches = sortedEvents(profile)
    .filter((e) => e.type === "match")
    .map(eventDate)
    .filter((d) => Math.abs(daysBetween(date, d)) <= 3);
  for (let i = 1; i < matches.length; i++) {
    if (daysBetween(matches[i - 1], matches[i]) <= 2) return true;
  }
  return false;
}

export function classifyDay(profile: AthleteProfile, date: string): DayType {
  if (eventsOn(profile, date, "match").length) return "match";
  if (eventsOn(profile, addDays(date, 1), "match").length) return "match_eve";
  if (eventsOn(profile, addDays(date, -1), "match").length) return "recovery";
  if (eventsOn(profile, date, "training").length) return "training";
  return "rest";
}

export function dailyTargets(profile: AthleteProfile, date: string, type = classifyDay(profile, date), wx?: WeatherIndex): DailyTargets {
  const M = profile.anthropometrics.bodyMassKg;
  const next = nextMatchFrom(profile, addDays(date, 1));
  const gameSoon = next ? daysBetween(date, eventDate(next)) <= 3 : false;

  let perKg: [number, number];
  let note: string;
  switch (type) {
    case "match":
      perKg = [6, 8];
      note = "Game day: carbs lead every meal, plus 30-60 g per hour during play.";
      break;
    case "match_eve":
      perKg = [6, 8];
      note = "Game tomorrow: top up energy stores with a carb-focused day and dinner.";
      break;
    case "recovery":
      perKg = gameSoon ? [6, 10] : [5, 7];
      note = gameSoon
        ? "Recovery day with another game close: refuel hard today."
        : "Recovery day: steady carbs, protein at every meal, and extra sleep.";
      break;
    case "training":
      perKg = [5, 7];
      note = "Practice day: fuel before practice and refuel within an hour after.";
      break;
    default:
      perKg = [3, 5];
      note = "Rest day: normal balanced meals. Protein and sleep still matter.";
  }

  // Position: keepers cover about half the distance of outfield players;
  // center backs a bit less than midfielders, fullbacks and wingers.
  const pos = positionFuel(profile);
  if (type !== "rest" && pos.carbDelta) {
    perKg = [Math.max(3, perKg[0] + pos.carbDelta), Math.max(4, perKg[1] + pos.carbDelta)];
    note += " " + pos.note;
  }

  const trainingMin =
    type === "match" ? 110 : type === "training" ? profile.training?.avgSessionMinutes || 90 : 0;
  const band = bandForAge(effectiveAge(profile.identity));
  // Weather: heat adds fluid; cold adds a little fuel.
  const wp = dayWeatherPlan(profile, date, wx);
  const fluidsL = Math.round(((band.fluidMlPerKg / 1000) * M + (trainingMin / 60) * (band.inGame === "water_fruit" ? 0.5 : 0.75) + (wp?.extraFluidL || 0)) * 10) / 10;
  if (wp?.extraCarbsPerKg) perKg = [perKg[0] + wp.extraCarbsPerKg, perKg[1] + wp.extraCarbsPerKg];
  if (wp && wp.severity !== "none") {
    note += wp.conditions.heat && wp.conditions.heat !== "green"
      ? ` Heat today: fluid target raised by ${wp.extraFluidL} L.`
      : wp.extraCarbsPerKg ? " Cold today: carb target raised a little to keep you warm and fueled." : "";
  }
  const P = band.proteinPerKg;
  const plate = type === "rest"
    ? "A third carbs, a third protein, a third vegetables and fruit."
    : type === "recovery"
      ? "Half carbs, a quarter protein, a quarter vegetables and fruit, plus a protein snack."
      : "Half carbs, a quarter protein, a quarter vegetables and fruit. Bigger portions today.";

  return {
    carbsPerKg: perKg,
    carbsG: [round5(perKg[0] * M), round5(perKg[1] * M)],
    proteinG: [round5(P[0] * M), round5(P[1] * M)],
    fluidsL,
    mode: band.targetsMode,
    plate,
    note,
  };
}

const HEADLINES: Record<DayType, string> = {
  match: "Game day",
  match_eve: "Game tomorrow",
  recovery: "Recovery day",
  training: "Practice day",
  rest: "Rest day",
};

export function buildToday(
  profile: AthleteProfile,
  date: string,
  checkin: DailyCheckIn | null,
  wx?: WeatherIndex,
): TodaySummary {
  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const type = classifyDay(profile, date);
  const targets = dailyTargets(profile, date, type, wx);
  const dayPlan = dayWeatherPlan(profile, date, wx);
  const eventPlans = eventsOn(profile, date)
    .filter((e) => e.type === "match" || e.type === "training")
    .map((e) => ({ type: e.type as string, time: e.startTime.slice(11, 16), plan: eventWeatherPlan(profile, e, wx) as WeatherPlan }))
    .filter((x) => !!x.plan);
  const todays = eventsOn(profile, date).map((e) => ref(e, date));
  const nm = nextMatchFrom(profile, date);
  const { wake, bed } = routineOf(profile);
  const tournament = inTournament(profile, date);

  const focus: string[] = [];
  const match = todays.find((e) => e.type === "match");
  if (type === "match" && match) {
    focus.push(`Pre-game meal about 3.5 hours before your ${to12(match.time)} kickoff.`);
    focus.push(band.inGame === "water_fruit"
      ? `Pack water and ${examples(safetyContext(profile, { gameDay: true }), ["orange", "banana", "grapes"], 2, "halftime")} for half-time, plus a recovery snack for right after.`
      : `Pack ${examples(safetyContext(profile, { gameDay: true }), ["sports_drink", "gel", "chews"], 2, "in_game")} for half-time, plus a recovery snack for right after.`);
  } else if (type === "match_eve") {
    focus.push("Carb-focused dinner tonight, and sip fluids through the evening.");
    focus.push(`Lay out your kit and aim for bed by ${to12(bed)}.`);
  } else if (type === "recovery") {
    focus.push("Protein at every meal and a carb-rich breakfast to keep refuelling.");
    focus.push("Light movement: a walk, easy spin or mobility work. Save hard training.");
  } else if (type === "training") {
    const t = todays.find((e) => e.type === "training");
    focus.push(`Snack 60-90 minutes before practice${t ? ` (${to12(t.time)})` : ""}.`);
    focus.push("Recovery snack with carbs and protein within an hour after.");
  } else {
    focus.push("Balanced meals, a full water bottle, and your normal routine.");
  }
  if (tournament) focus.unshift("Tournament stretch: every meal and every hour of sleep counts.");
  if (dayPlan && dayPlan.severity !== "none" && dayPlan.actions[0]) focus.unshift(dayPlan.actions[0]);
  focus.push(fillText(band.focus[date.charCodeAt(9) % band.focus.length], safetyContext(profile)));
  focus.push(`Wake ${to12(wake)}. Lights out ${to12(bed)}.`);
  // Is the routine long enough for this age's sleep need?
  const [need] = sleepHoursFor(age);
  const window = ((toMin(wake) - toMin(bed) + 1440) % 1440) / 60;
  if (window < need) {
    const ideal = fromMin(Math.floor((toMin(wake) - need * 60 - 30 + 1440) / 15) * 15);
    focus.unshift(`${parentVoice(age) ? `${(profile.identity.fullName || "").split(" ")[0]} needs` : "You need"} at least ${need} hours of sleep. Bedtime ${to12(bed)} to ${to12(wake)} is only ${Math.round(window * 10) / 10} hours. Try lights out by ${to12(ideal)}.`);
  }

  const readiness = computeReadiness(checkin);
  return {
    profileId: profile.id,
    date,
    firstName: (profile.identity.fullName || "").trim().split(/\s+/)[0] || "Athlete",
    dayType: type,
    headline: HEADLINES[type],
    focus,
    todaysEvents: todays,
    nextMatch: nm ? ref(nm, date) : null,
    targets,
    readiness,
    checkedIn: !!checkin,
    tournament,
    weather: {
      day: dayPlan,
      events: eventPlans,
      // Tomorrow's games, so there's time to freeze bottles or pack layers.
      tomorrow: eventsOn(profile, addDays(date, 1), "match")
        .map((e) => ({ time: e.startTime.slice(11, 16), plan: eventWeatherPlan(profile, e, wx) as WeatherPlan }))
        .filter((x) => !!x.plan && x.plan.severity !== "none"),
      homeZip: profile.routine?.homeZip || null,
    },
    program: {
      id: band.id, name: band.name, ages: band.ages, tagline: band.tagline,
      sleepHours: sleepHoursFor(age), parentVoice: parentVoice(age),
    },
    safety: {
      confirmed: !!profile.nutrition.safetyConfirmedAt,
      epinephrine: (profile.nutrition.allergies || []).some((a) => a.epinephrine || a.anaphylaxis),
      medicalDiets: profile.nutrition.medicalDiets || [],
    },
    disclaimer:
      "Starting targets from published sports-nutrition guidance. Not medical advice. Check with a doctor or dietitian for medical conditions.",
  };
}

/** Position-specific fueling. Baseline = high-running outfield player. */
export function positionFuel(profile: AthleteProfile): { position: string; carbDelta: number; note: string; tips: string[] } {
  const pos = (profile.sport.positions || [])[0] || "";
  switch (pos) {
    case "goalkeeper":
      return { position: "goalkeeper", carbDelta: -1.5, note: "Keeper: a little less fuel than field players on busy days.", tips: [
        "You run about half as far as field players, but explode often: protein at every meal for power.",
        "Keep a bottle in the goal and sip in every stoppage. Keepers forget to drink.",
        "Cold days hit keepers hardest: layers, and a warm drink at half-time.",
      ] };
    case "defender":
      return { position: "center back", carbDelta: -0.5, note: "Center back: slightly less fuel than midfielders.", tips: [
        "Strength and heading duels: protein spread over the day.",
        "Lots of short sprints: carbs before games still matter.",
      ] };
    case "midfielder":
      return { position: "midfielder", carbDelta: 0, note: "", tips: [
        "Midfielders cover the most ground: the most carbs of any position on game days.",
        "Sip at every break. Top up carbs at half-time.",
      ] };
    case "fullback":
    case "winger":
      return { position: pos, carbDelta: 0, note: "", tips: [
        "Repeated sprints up and down the line: full carbs on game days and a half-time top-up.",
        "Hamstrings work hard in your position: never skip the warm-up.",
      ] };
    case "forward":
      return { position: "forward", carbDelta: -0.25, note: "", tips: [
        "Short explosive sprints: carbs 2 to 3 hours before, and stay light on your feet.",
        "Protein after games helps you recover for the next sprint-heavy match.",
      ] };
    default:
      return { position: pos, carbDelta: 0, note: "", tips: [] };
  }
}
