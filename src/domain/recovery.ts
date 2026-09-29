/**
 * Multi-day recovery planner (pure).
 *
 * Anchors on a match (the one requested, or the most recent one) and plans
 * every day from that match through two days after the last linked match.
 * Matches no more than two days apart are linked into one "tournament"
 * stretch, and the gap between each pair gets its own refuel window:
 *
 *   gap under 8 h    fast refuel: ~1.0-1.2 g/kg carbs per hour for the first 4 h
 *   gap 8-24 h       6-10 g/kg carbs across the day, recovery meal within 1 h
 *   gap over 24 h    normal recovery-day targets
 *
 * Per-meal protein is 0.3-0.4 g/kg spread over 4-5 feedings. Ranges follow
 * published sports-nutrition position stands; they are starting points only.
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { safeFoodSuggestions } from "./plan.js";
import { computeReadiness, type Readiness } from "./readiness.js";
import { addDays, daysBetween, eventDate, eventTime, shiftLocal, shortDate, sortedEvents, to12, toMin } from "./dates.js";

export interface RecoveryDay {
  date: string;
  label: string;
  title: string;
  carbs: string;
  protein: string;
  actions: string[];
  foods: string[];
  readiness: Readiness | null;
  isMatchDay: boolean;
}

export interface TurnaroundWindow {
  from: string; // YYYY-MM-DDTHH:MM (end of game)
  to: string; // next kickoff
  gapHours: number;
  kind: "fast" | "same_or_next_day" | "normal";
  title: string;
  steps: string[];
}

export interface RecoveryPlan {
  profileId: string;
  anchor: { date: string; time: string } | null;
  tournament: boolean;
  matches: { date: string; time: string; conditions?: string }[];
  windows: TurnaroundWindow[];
  days: RecoveryDay[];
  message?: string;
  disclaimer: string;
}

const r5 = (n: number) => Math.round(n / 5) * 5;
const DISCLAIMER =
  "Starting targets from published sports-nutrition guidance. Not medical advice. Pain that lingers or gets worse needs a doctor or athletic trainer.";

function matchStartMin(e: ScheduledEvent): number {
  return daysBetween("2000-01-01", eventDate(e)) * 1440 + toMin(eventTime(e));
}

export function buildRecoveryPlan(
  profile: AthleteProfile,
  opts: { today: string; anchorDate?: string; checkins?: DailyCheckIn[] },
): RecoveryPlan {
  const M = profile.anthropometrics.bodyMassKg;
  const matches = sortedEvents(profile).filter((e) => e.type === "match");
  const byDate = new Map((opts.checkins || []).map((c) => [c.date, c]));

  let anchor: ScheduledEvent | undefined;
  if (opts.anchorDate) anchor = matches.find((e) => eventDate(e) === opts.anchorDate);
  if (!anchor) {
    const past = matches.filter((e) => eventDate(e) <= opts.today);
    anchor = past[past.length - 1];
    if (anchor && daysBetween(eventDate(anchor), opts.today) > 3) anchor = undefined;
  }
  if (!anchor) {
    return {
      profileId: profile.id,
      anchor: null,
      tournament: false,
      matches: [],
      windows: [],
      days: [],
      message: "No recent game on your schedule. After your next game, your recovery plan shows up here.",
      disclaimer: DISCLAIMER,
    };
  }

  // Link neighbouring matches (<= 2 days apart) into one stretch.
  const idx = matches.indexOf(anchor);
  let lo = idx;
  let hi = idx;
  while (lo > 0 && daysBetween(eventDate(matches[lo - 1]), eventDate(matches[lo])) <= 2) lo--;
  while (hi < matches.length - 1 && daysBetween(eventDate(matches[hi]), eventDate(matches[hi + 1])) <= 2) hi++;
  const cluster = matches.slice(lo, hi + 1);
  const tournament = cluster.length > 1;

  const carbs = safeFoodSuggestions(profile, "carb");
  const protein = safeFoodSuggestions(profile, "protein");
  const perMealP = `${r5(0.3 * M)}-${r5(0.4 * M)} g`;

  // Turnaround windows between linked matches.
  const windows: TurnaroundWindow[] = [];
  for (let i = 0; i < cluster.length - 1; i++) {
    const a = cluster[i];
    const b = cluster[i + 1];
    const endA = matchStartMin(a) + 110;
    const gapHours = Math.round(((matchStartMin(b) - endA) / 60) * 10) / 10;
    const endStr = shiftLocal(eventDate(a), eventTime(a), 110);
    const to = `${eventDate(b)}T${eventTime(b)}`;
    if (gapHours < 8) {
      windows.push({
        from: endStr, to, gapHours, kind: "fast",
        title: `Fast turnaround: ${gapHours} h until the next game`,
        steps: [
          `Start within 15 minutes: about ${r5(1.1 * M)} g carbs per hour for the next 4 hours, in small, frequent doses.`,
          "Easy-to-digest carbs only: sports drink, banana, white rice, honey. Keep fat and fibre low.",
          `Add ${r5(0.3 * M)} g protein in the first hour.`,
          "Rehydrate with electrolytes. Aim for pale-yellow urine before the next warm-up.",
          "Legs up, shade or cool room, no extra running.",
        ],
      });
    } else if (gapHours <= 24) {
      windows.push({
        from: endStr, to, gapHours, kind: "same_or_next_day",
        title: `Next game in ${Math.round(gapHours)} h`,
        steps: [
          `Recovery snack within 30 minutes: about ${r5(1.2 * M)} g carbs + ${r5(0.3 * M)}-40 g protein.`,
          `Full meal within 2 hours. Aim for ${r5(6 * M)}-${r5(10 * M)} g carbs across the next 24 hours.`,
          "Replace about 150% of the fluid you lost, with salt or electrolytes.",
          "Slow protein before bed and at least 8-9 hours of sleep.",
          "Morning of the next game: normal pre-game meal 3-4 hours before kickoff.",
        ],
      });
    } else {
      windows.push({
        from: endStr, to, gapHours, kind: "normal",
        title: `${Math.round(gapHours / 24)} days until the next game`,
        steps: ["Follow the day-by-day plan below."],
      });
    }
  }

  // Day-by-day, from first match through two days after the last.
  const first = eventDate(cluster[0]);
  const last = eventDate(cluster[cluster.length - 1]);
  const upcomingAfter = matches[hi + 1] ? eventDate(matches[hi + 1]) : null;
  const days: RecoveryDay[] = [];
  const span = daysBetween(first, last) + 2;
  for (let d = 0; d <= span; d++) {
    const date = addDays(first, d);
    const matchesToday = cluster.filter((e) => eventDate(e) === date);
    const isMatchDay = matchesToday.length > 0;
    const after = daysBetween(last, date); // 1, 2 after final game
    const gameSoon = upcomingAfter ? daysBetween(date, upcomingAfter) <= 3 : false;
    const ci = byDate.get(date) || null;
    const readiness = computeReadiness(ci);
    const sore = (ci?.sorenessLevel ?? 0) >= 7;

    let label: string;
    let title: string;
    let carbsTxt: string;
    const actions: string[] = [];
    if (isMatchDay) {
      label = matchesToday.length > 1 ? `${matchesToday.length} games` : `Game ${cluster.indexOf(matchesToday[0]) + 1}`;
      title = `Game day: ${matchesToday.map((e) => to12(eventTime(e))).join(" and ")}`;
      carbsTxt = `${r5(6 * M)}-${r5(8 * M)} g plus 30-60 g per hour during play`;
      actions.push("Recovery snack within 30 minutes of the final whistle.");
      actions.push("Recovery dinner within 2 hours: carbs + protein + vegetables.");
      actions.push("Slow protein before bed, such as Greek yogurt or a protein shake if you tolerate dairy.");
      actions.push("Screens off early. Sleep is the biggest recovery tool you have.");
    } else if (date > first && date < last) {
      label = "Between games";
      title = "Between games: refuel and stay loose";
      carbsTxt = `${r5(6 * M)}-${r5(10 * M)} g`;
      actions.push("Carbs at every meal and snack. You are refilling for the next game.");
      actions.push("15-20 minutes of easy movement and stretching. No extra hard running.");
      actions.push("Nap 20-30 minutes if you slept badly.");
    } else if (after === 1) {
      label = "Day +1";
      title = "Refuel and restore";
      carbsTxt = gameSoon ? `${r5(6 * M)}-${r5(10 * M)} g` : `${r5(5 * M)}-${r5(7 * M)} g`;
      actions.push("Carb-rich breakfast within an hour of waking.");
      actions.push(`Protein at 4-5 meals and snacks, about ${perMealP} each.`);
      actions.push("Active recovery only: walk, easy bike or swim, mobility, foam rolling.");
      actions.push("Aim for 9 hours of sleep tonight.");
      if (tournament) actions.push("After a tournament, add one extra rest day before any hard session.");
    } else {
      label = `Day +${after}`;
      title = gameSoon ? "Sharpen for the next game" : "Back to normal training";
      carbsTxt = gameSoon ? `${r5(6 * M)}-${r5(8 * M)} g` : `${r5(5 * M)}-${r5(7 * M)} g`;
      actions.push(
        sore
          ? "Still sore: keep it light today and tell your coach."
          : "If soreness is 5 or lower, normal training is fine.",
      );
      actions.push(`Protein ${perMealP} at each meal.`);
    }
    if (sore && !isMatchDay) actions.unshift("You logged high soreness. Extra mobility, extra sleep, and no hard sprinting today.");

    days.push({
      date,
      label: `${label} · ${shortDate(date)}`,
      title,
      carbs: carbsTxt,
      protein: `${r5(1.6 * M)}-${r5(2.0 * M)} g`,
      actions,
      foods: [...carbs.slice(0, 3), ...protein.slice(0, 3)],
      readiness,
      isMatchDay,
    });
  }

  return {
    profileId: profile.id,
    anchor: { date: eventDate(anchor), time: eventTime(anchor) },
    tournament,
    matches: cluster.map((e) => ({ date: eventDate(e), time: eventTime(e), conditions: e.conditions })),
    windows,
    days,
    disclaimer: DISCLAIMER,
  };
}
