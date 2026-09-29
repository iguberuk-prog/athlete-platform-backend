/**
 * Calendar helpers shared by the planning engines.
 *
 * Everything works on local wall-clock strings (YYYY-MM-DD and HH:MM), the same
 * way events are stored. Arithmetic runs at UTC noon so daylight-saving shifts
 * never move a date.
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";

export const toMin = (hm: string): number => {
  const [h, m] = String(hm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const fromMin = (min: number): string => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

/** Round minutes-of-day to the nearest 15 minutes. */
export const snap15 = (min: number): number => Math.round(min / 15) * 15;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000,
  );
}

export const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export const eventDate = (e: ScheduledEvent): string => e.startTime.slice(0, 10);

/** Literal HH:MM from a stored startTime, or a fallback when it has none. */
export function eventTime(e: ScheduledEvent, fallback = "19:00"): string {
  const hhmm = e.startTime.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : fallback;
}

export function sortedEvents(profile: AthleteProfile): ScheduledEvent[] {
  return [...(profile.schedule?.events || [])].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
}

export function eventsOn(profile: AthleteProfile, date: string, type?: string): ScheduledEvent[] {
  return sortedEvents(profile).filter(
    (e) => eventDate(e) === date && (!type || e.type === type),
  );
}

export function routineOf(profile: AthleteProfile): { wake: string; bed: string; practice: string } {
  return {
    wake: profile.routine?.wakeTime || "07:00",
    bed: profile.routine?.bedTime || "22:30",
    practice: profile.routine?.usualPracticeTime || "17:00",
  };
}

/** Readable "Sat, Oct 3" label for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Local "YYYY-MM-DDTHH:MM" for `date`+`time` shifted by `min` minutes (can cross midnight). */
export function shiftLocal(date: string, time: string, min: number): string {
  const total = toMin(time) + min;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(date, dayShift)}T${fromMin(total)}`;
}

/** "18:30" -> "6:30 PM" for user-facing text. */
export function to12(hm: string): string {
  const [h0, m = "00"] = String(hm || "").split(":");
  const h = Number(h0) || 0;
  return `${h % 12 || 12}:${m.padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * Morning of a game: when to wake and when to eat the pre-game meal.
 *
 *   - Normal: full meal 3.5 h before kickoff, at least 30 min after waking.
 *   - Early kickoff: the meal slides later and gets lighter, as close as
 *     90 minutes before kickoff (small, easy carbs).
 *   - Very early kickoff: wake 2 h before, eat 90 min before.
 * `gapMin` is how long before kickoff the meal lands.
 */
export function gameMorning(
  kickoff: string,
  wakeTime: string,
): { wake: string; preMeal: string; lighter: boolean; earlyAlarm: boolean; gapMin: number } {
  const k = toMin(kickoff);
  const w = toMin(wakeTime);
  const ideal = snap15(k - 210);
  if (ideal >= w + 30) return { wake: wakeTime, preMeal: fromMin(ideal), lighter: false, earlyAlarm: false, gapMin: k - ideal };
  const firstAfterWake = Math.ceil((w + 30) / 15) * 15;
  if (firstAfterWake <= k - 90) {
    return { wake: wakeTime, preMeal: fromMin(firstAfterWake), lighter: firstAfterWake > k - 180, earlyAlarm: false, gapMin: k - firstAfterWake };
  }
  return { wake: fromMin(k - 120), preMeal: fromMin(k - 90), lighter: true, earlyAlarm: true, gapMin: 90 };
}
