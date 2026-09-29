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
import {
  addDays,
  daysBetween,
  eventDate,
  eventTime,
  eventsOn,
  routineOf,
  sortedEvents,
  to12,
} from "./dates.js";

export type DayType = "match" | "match_eve" | "recovery" | "training" | "rest";

export interface DailyTargets {
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

export function dailyTargets(profile: AthleteProfile, date: string, type = classifyDay(profile, date)): DailyTargets {
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

  const trainingMin =
    type === "match" ? 110 : type === "training" ? profile.training?.avgSessionMinutes || 90 : 0;
  const fluidsL = Math.round((0.035 * M + (trainingMin / 60) * 0.75) * 10) / 10;

  return {
    carbsPerKg: perKg,
    carbsG: [round5(perKg[0] * M), round5(perKg[1] * M)],
    proteinG: [round5(1.5 * M), round5(2.0 * M)],
    fluidsL,
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
): TodaySummary {
  const type = classifyDay(profile, date);
  const targets = dailyTargets(profile, date, type);
  const todays = eventsOn(profile, date).map((e) => ref(e, date));
  const nm = nextMatchFrom(profile, date);
  const { wake, bed } = routineOf(profile);
  const tournament = inTournament(profile, date);

  const focus: string[] = [];
  const match = todays.find((e) => e.type === "match");
  if (type === "match" && match) {
    focus.push(`Pre-game meal about 3.5 hours before your ${to12(match.time)} kickoff.`);
    focus.push("Pack a sports drink or gel for half-time, plus a recovery snack for right after.");
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
  focus.push(`Wake ${to12(wake)}. Lights out ${to12(bed)}.`);

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
    disclaimer:
      "Starting targets from published sports-nutrition guidance. Not medical advice. Check with a doctor or dietitian for medical conditions.",
  };
}
