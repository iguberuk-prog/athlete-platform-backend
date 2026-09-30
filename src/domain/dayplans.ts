/**
 * School-day planner and travel planner (pure).
 *
 * School day: fits meals and snacks around classes and practice, so a player
 * doesn't show up to a 4 PM practice on a lunch eaten at 10:45.
 *
 * Travel: for away games and tournaments in another ZIP or time zone,
 * builds a sleep-shift plan and a safe food bag.
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { parentVoice } from "./ageBands.js";
import { addDays, eventDate, eventTime, eventsOn, fromMin, routineOf, sortedEvents, to12, toMin, daysBetween } from "./dates.js";
import { examples, safetyContext } from "./foods.js";
import type { WeatherIndex } from "./weather.js";

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export interface DayStep { time: string; label: string; detail: string }

export interface SchoolDayPlan {
  date: string;
  schoolDay: boolean;
  steps: DayStep[];
  tips: string[];
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function schoolDayPlan(profile: AthleteProfile, date: string): SchoolDayPlan | null {
  const sc = profile.routine?.school;
  if (!sc) return null;
  const isSchool = sc.days.includes(weekday(date));
  if (!isSchool) return { date, schoolDay: false, steps: [], tips: ["No school today. Regular meals, and follow today's plan."] };
  const c = safetyContext(profile);
  const r = routineOf(profile);
  const kid = parentVoice(effectiveAge(profile.identity));
  const steps: DayStep[] = [];
  const start = toMin(sc.start), end = toMin(sc.end);
  const breakfast = Math.max(toMin(r.wake) + 15, start - 60);
  steps.push({ time: fromMin(breakfast), label: "Breakfast", detail: `Don't skip it. ${capFirst(examples(c, ["oats", "eggs", "greek_yogurt", "toast", "banana", "berries"], 3, "breakfast"))}.` });
  const lunch = sc.lunch ? toMin(sc.lunch) : Math.round((start + end) / 2 / 15) * 15;
  if (sc.snackBreak !== false && lunch - start > 180)
    steps.push({ time: fromMin(Math.round((start + lunch) / 2 / 15) * 15), label: "Mid-morning snack", detail: `A quick snack between classes: ${examples(c, ["banana", "rice_cakes", "cheese", "grapes", "crackers"], 2, "snack")}.` });
  steps.push({ time: fromMin(lunch), label: "Lunch", detail: `A full plate: a starch, a protein and fruit or veg. ${kid ? "Pack it so you know it's safe." : "Bring it from home if the cafeteria is a guess."}` });
  const practice = eventsOn(profile, date).find((e) => e.type === "training" || e.type === "match");
  if (practice) {
    const p = toMin(eventTime(practice, r.practice));
    const gap = p - lunch;
    if (gap > 150) {
      const snack = Math.max(end, p - 75);
      steps.push({ time: fromMin(snack), label: "Pre-practice snack", detail: `${Math.round(gap / 60)} hours since lunch. Eat about an hour before ${practice.type === "match" ? "the game" : "practice"}: ${examples(c, ["banana", "bagel", "pretzels", "applesauce", "rice_cakes"], 2, "quick_carb")}, plus water.` });
    }
    steps.push({ time: fromMin(p), label: practice.type === "match" ? "Game" : "Practice", detail: "Bottle filled and in the bag." });
    steps.push({ time: fromMin(p + 120), label: "Recovery dinner", detail: `Within 1 to 2 hours after: ${examples(c, ["rice_bowl", "chicken", "pasta", "tofu_bowl", "salmon", "potato"], 3)}.` });
  } else {
    steps.push({ time: fromMin(end + 30), label: "After-school snack", detail: `${capFirst(examples(c, ["greek_yogurt", "apple", "cheese", "hummus", "banana"], 2, "snack"))}.` });
  }
  steps.sort((a, b) => a.time.localeCompare(b.time));
  const tips = [
    "Keep a water bottle at your desk. Refill at lunch.",
    "Keep a backup snack in the locker or bag for days practice runs late.",
  ];
  return { date, schoolDay: true, steps: steps.map((s) => ({ ...s, time: to12(s.time) })), tips };
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

/** Offset in minutes of a time zone at a given date. */
export function tzOffsetMin(tz: string, date: string): number | null {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d);
    const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch {
    return null;
  }
}

export interface TravelPlan {
  event: { date: string; time: string; type: string; title?: string; zip?: string; place?: string };
  daysAway: number;
  hoursShift: number;
  direction: "east" | "west" | "none";
  sleep: string[];
  food: string[];
  packing: string[];
}

/** Away events: any event at a ZIP other than home, or a "travel"/"tournament" event, in the next `days` days. */
export function travelPlans(profile: AthleteProfile, today: string, wx?: WeatherIndex, days = 14): TravelPlan[] {
  const home = profile.routine?.homeZip;
  const end = addDays(today, days);
  const seen = new Set<string>();
  const out: TravelPlan[] = [];
  const c = safetyContext(profile, { gameDay: true });
  const kid = parentVoice(effectiveAge(profile.identity));
  for (const e of sortedEvents(profile)) {
    const d = eventDate(e);
    if (d < today || d > end) continue;
    const away = e.type === "travel" || e.type === "tournament" || (!!e.zip && !!home && e.zip !== home);
    if (!away) continue;
    const key = `${d}:${e.zip || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const destTz = (e.zip && wx?.byZip[e.zip]?.timeZone) || profile.timezone;
    const a = tzOffsetMin(profile.timezone, d), b = tzOffsetMin(destTz, d);
    const shift = a !== null && b !== null ? (b - a) / 60 : 0;
    const direction = shift > 0 ? "east" : shift < 0 ? "west" : "none";
    const sleep: string[] = [];
    const r = routineOf(profile);
    if (Math.abs(shift) >= 2) {
      const step = direction === "east" ? -30 : 30;
      sleep.push(`${Math.abs(shift)} hour${Math.abs(shift) === 1 ? "" : "s"} ${direction === "east" ? "ahead" : "behind"} at the destination.`);
      sleep.push(`Starting 3 days before, move bedtime ${direction === "east" ? "earlier" : "later"} by 30 minutes a day: ${[1, 2, 3].map((i) => to12(fromMin(toMin(r.bed) + step * i))).join(", ")}.`);
      sleep.push(direction === "east" ? "Get bright light early in the morning at the destination. Avoid screens late." : "Get daylight in the late afternoon at the destination to stay up later.");
    } else if (Math.abs(shift) === 1) {
      sleep.push("One hour of time change: keep your normal routine by the destination's clock.");
    } else {
      sleep.push("Same time zone. Keep the usual bedtime, even in a hotel.");
    }
    const hrsAway = e.zip && home && e.zip !== home ? "a long drive or flight" : "travel";
    const food = [
      `Don't count on finding safe food on the road. Pack a cooler for ${hrsAway}: ${examples(c, ["bagel", "banana", "rice_cakes", "pretzels", "grapes", "turkey_sandwich", "cheese"], 4, undefined)}.`,
      "Drink a cup of water every hour of the trip. Planes and car air-conditioning dry you out.",
      "Get up and walk every 1 to 2 hours on long drives and flights so legs don't stiffen.",
      "Eating out: look for a plain starch plus a grilled protein. See the Eating out guide.",
    ];
    const packing = ["Refillable water bottle", "Cooler with ice packs", "Snacks for every day away", "Recovery drink or snack for after each game"];
    if (c.allergens.length || c.medical.length) packing.unshift(kid ? "Allergy action plan and medicines" : "Your allergy card and medicines");
    if ((profile.nutrition.allergies || []).some((x) => x.epinephrine)) packing.unshift("Two EpiPens (never in checked bags)");
    if (profile.health?.asthma?.has) packing.unshift("Inhaler");
    out.push({
      event: { date: d, time: to12(eventTime(e, r.practice)), type: e.type, title: e.title, zip: e.zip, place: e.zip ? wx?.byZip[e.zip]?.place : undefined },
      daysAway: Math.max(0, daysBetween(today, d)),
      hoursShift: shift,
      direction,
      sleep, food, packing,
    });
  }
  return out;
}

export function isAwayEvent(profile: AthleteProfile, e: ScheduledEvent): boolean {
  const home = profile.routine?.homeZip;
  return e.type === "travel" || e.type === "tournament" || (!!e.zip && !!home && e.zip !== home);
}
