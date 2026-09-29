/**
 * Reminder schedule (pure).
 *
 * Turns the athlete's schedule and routine into timed nudges for the next N
 * days. The server computes the schedule; the phone app turns each one into a
 * local notification (works offline, no push server), and the web app shows
 * them in-app.
 *
 * Kinds:
 *   checkin     morning check-in (every day)
 *   fuel        night-before dinner, pre-game meal, top-up, pre-practice snack
 *   hydrate     hydration nudges on game and practice days
 *   recover     recovery snack and recovery dinner after games and practices
 *   sleep       wind-down before bed (every day; stronger before games)
 *
 * Times are local wall-clock strings ("YYYY-MM-DDTHH:MM"), the same format as
 * events. Ids are stable, so re-syncing never creates duplicates.
 */

import type { AthleteProfile } from "./profile.js";
import { addDays, eventTime, eventsOn, gameMorning, routineOf, shiftLocal, snap15, to12, toMin, fromMin } from "./dates.js";

export type ReminderKind = "checkin" | "fuel" | "hydrate" | "recover" | "sleep";

export interface Reminder {
  id: string;
  at: string; // YYYY-MM-DDTHH:MM local
  kind: ReminderKind;
  title: string;
  body: string;
}

export interface ReminderPrefs {
  checkin?: boolean;
  fuel?: boolean;
  hydrate?: boolean;
  recover?: boolean;
  sleep?: boolean;
}

const r5 = (n: number) => Math.round(n / 5) * 5;

export function buildReminders(
  profile: AthleteProfile,
  opts: { from: string; days?: number; now?: string; prefs?: ReminderPrefs },
): Reminder[] {
  const days = Math.max(1, Math.min(14, opts.days ?? 7));
  const prefs = { checkin: true, fuel: true, hydrate: true, recover: true, sleep: true, ...(opts.prefs || {}) };
  const M = profile.anthropometrics.bodyMassKg;
  const { wake, bed, practice } = routineOf(profile);
  const out: Reminder[] = [];

  const add = (date: string, time: string, kind: ReminderKind, title: string, body: string) => {
    if (!prefs[kind]) return;
    const at = `${date}T${time}`;
    out.push({ id: `${profile.id.slice(0, 8)}-${kind}-${at}`, at, kind, title, body });
  };
  const addAt = (at: string, kind: ReminderKind, title: string, body: string) =>
    add(at.slice(0, 10), at.slice(11, 16), kind, title, body);

  for (let i = 0; i < days; i++) {
    const date = addDays(opts.from, i);
    const matches = eventsOn(profile, date, "match");
    const practices = eventsOn(profile, date, "training");
    const matchTomorrow = eventsOn(profile, addDays(date, 1), "match")[0];

    const firstGame = matches[0] ? gameMorning(eventTime(matches[0]), wake) : null;
    const dayWake = firstGame ? firstGame.wake : wake;
    add(date, fromMin(toMin(dayWake) + 30), "checkin", "Morning check-in", "30 seconds: sleep, energy, soreness. It tunes today's plan.");

    for (const [mi, m] of matches.entries()) {
      const k = eventTime(m);
      const kMin = toMin(k);
      const gm = gameMorning(k, wake);
      const mealAt = mi === 0 ? gm.preMeal : fromMin(snap15(kMin - 180));
      addAt(`${date}T${mealAt}`, "fuel", "Pre-game meal now",
        gm.lighter && mi === 0
          ? gm.gapMin <= 120
            ? `Kickoff at ${to12(k)}. Small and easy: about ${r5(1 * M)} g carbs, like a banana and toast with honey. Sip fluids.`
            : `Kickoff at ${to12(k)}. Lighter meal: ${r5(1 * M)}-${r5(2 * M)} g easy carbs, very low fat and fibre.`
          : `Kickoff at ${to12(k)}. Aim for ${r5(1 * M)}-${r5(3 * M)} g carbs, low fat and fibre. Keep it familiar.`);
      addAt(shiftLocal(date, k, -90), "hydrate", "Pack your bottles",
        "Water plus a sports drink, and a gel or chews for half-time.");
      addAt(shiftLocal(date, fromMin(snap15(kMin - 60)), 0), "fuel", "Top-up snack",
        "Small, fast carbs: banana, honey or sports drink. Sip fluids.");
      addAt(shiftLocal(date, k, 130), "recover", "Recovery snack now",
        `The first 30 minutes matter. About ${r5(1.2 * M)} g carbs plus protein, and rehydrate.`);
      addAt(shiftLocal(date, k, 230), "recover", "Recovery dinner",
        "Full plate: carbs, protein and vegetables. Keep sipping fluids.");
    }

    if (!matches.length) {
      for (const p of practices) {
        const t = /T\d{2}:\d{2}/.test(p.startTime) ? eventTime(p) : practice;
        const len = profile.training?.avgSessionMinutes || 90;
        addAt(shiftLocal(date, t, -75), "fuel", "Pre-practice snack",
          `Practice at ${to12(t)}. A carb snack now, like a banana, toast or a granola bar, plus water.`);
        addAt(shiftLocal(date, t, len + 20), "recover", "Refuel after practice",
          "Carbs and protein within the hour: chocolate milk, a sandwich or a rice bowl.");
      }
    }

    if (matches.length || practices.length) {
      for (const hm of ["10:30", "13:30"]) {
        const clash = out.some((r) => r.at.slice(0, 10) === date && Math.abs(toMin(r.at.slice(11)) - toMin(hm)) < 45);
        if (!clash && toMin(hm) > toMin(wake) + 60) add(date, hm, "hydrate", "Water check", "Finish a bottle before your next reminder. Pale-yellow urine is the goal.");
      }
    }

    if (matchTomorrow && !matches.length) {
      add(date, "18:00", "fuel", "Game tomorrow: carb dinner",
        `Make carbs the centre of the plate tonight. Kickoff tomorrow at ${to12(eventTime(matchTomorrow))}.`);
    }

    const windDown = fromMin(snap15(toMin(bed) - 45));
    const tmr = matchTomorrow ? gameMorning(eventTime(matchTomorrow), wake) : null;
    add(date, windDown, "sleep",
      matchTomorrow ? "Big day tomorrow: wind down" : "Wind down",
      matchTomorrow
        ? `Screens off, kit laid out, lights out by ${to12(bed)}.${tmr?.earlyAlarm ? ` Set your alarm for ${to12(tmr.wake)}.` : ""} Sleep is part of your prep.`
        : `Lights out by ${to12(bed)}. Aim for 8-9 hours.`);
  }

  const now = opts.now || "";
  return out
    .filter((r) => !now || r.at > now)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Upcoming reminders for one day only (used by the Today screen). */
export function remindersForDay(profile: AthleteProfile, date: string, now?: string): Reminder[] {
  return buildReminders(profile, { from: date, days: 1, now });
}
