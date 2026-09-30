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
import { bandForAge, parentVoice, sleepHoursFor } from "./ageBands.js";
import { effectiveAge } from "./profile.js";
import { examples, safetyContext } from "./foods.js";
import { cups, eventWeatherPlan, type WeatherIndex } from "./weather.js";
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
  opts: { from: string; days?: number; now?: string; prefs?: ReminderPrefs; weather?: WeatherIndex },
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

  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const young = band.inGame === "water_fruit";
  const kid = parentVoice(age);
  const first = (profile.identity.fullName || "").trim().split(/\s+/)[0] || "your athlete";
  const [sleepLo, sleepHi] = sleepHoursFor(age);
  const cg = safetyContext(profile, { gameDay: true });
  const c = safetyContext(profile);
  const QUICK = ["banana", "toast", "gf_toast", "rice_cakes", "applesauce", "honey", "jam"];
  const RECOVER = ["choc_milk", "greek_yogurt", "lf_yogurt", "soy_milk", "turkey_sandwich", "rice_bowl", "tofu_bowl", "plant_shake", "whey"];
  // Under 13 the reminders go to the parent: "Pack Lea's bottle", not "Pack your bottles".
  const your = kid ? `${first}'s` : "your";

  for (let i = 0; i < days; i++) {
    const date = addDays(opts.from, i);
    const matches = eventsOn(profile, date, "match");
    const practices = eventsOn(profile, date, "training");
    const matchTomorrow = eventsOn(profile, addDays(date, 1), "match")[0];

    const firstGame = matches[0] ? gameMorning(eventTime(matches[0]), wake) : null;
    const dayWake = firstGame ? firstGame.wake : wake;
    add(date, fromMin(toMin(dayWake) + 30), "checkin", kid ? `Check in for ${first}` : "Morning check-in",
      kid ? `30 seconds: how did ${first} sleep, and how are they feeling?` : "30 seconds: sleep, energy, soreness. It tunes today's plan.");

    for (const [mi, m] of matches.entries()) {
      const k = eventTime(m);
      const kMin = toMin(k);
      const gm = gameMorning(k, wake);
      const mealAt = mi === 0 ? gm.preMeal : fromMin(snap15(kMin - 180));
      const small = gm.lighter && mi === 0 && gm.gapMin <= 120;
      addAt(`${date}T${mealAt}`, "fuel", kid ? `${first}'s pre-game meal` : "Pre-game meal now",
        young
          ? `Kickoff at ${to12(k)}. ${small ? "A small, easy meal" : "A normal meal, half the plate carbs"}: ${examples(cg, small ? QUICK : ["rice", "pasta", "gf_pasta", "bagel", "toast", "gf_toast", "potato"], 2, small ? "quick_carb" : "meal_carb")}. Low fat, and water.`
          : small
            ? `Kickoff at ${to12(k)}. Small and easy: about ${r5(1 * M)} g carbs, like ${examples(cg, QUICK, 2, "quick_carb")}. Sip fluids.`
            : gm.lighter && mi === 0
              ? `Kickoff at ${to12(k)}. Lighter meal: ${r5(1 * M)}-${r5(2 * M)} g easy carbs, very low fat and fibre.`
              : `Kickoff at ${to12(k)}. Aim for ${r5(1 * M)}-${r5(3 * M)} g carbs, low fat and fibre. Keep it familiar.`);
      const inGame = young
        ? `Water bottle, plus ${examples(cg, ["orange", "banana", "grapes"], 2, "halftime")} for half-time.`
        : `Water plus ${examples(cg, ["sports_drink", "gel", "chews", "banana"], 2, "in_game")} for half-time.`;
      const epi = (profile.nutrition.allergies || []).some((a) => a.epinephrine || a.anaphylaxis) ? " Don't forget the EpiPen." : "";
      addAt(shiftLocal(date, k, -90), "hydrate", kid ? `Pack ${first}'s bag` : "Pack your bottles", inGame + epi);
      addAt(shiftLocal(date, fromMin(snap15(kMin - 60)), 0), "fuel", "Top-up snack",
        `Small, fast carbs: ${examples(cg, ["banana", "rice_cakes", "applesauce", "toast", "gf_toast", "sports_drink"], 2, "quick_carb")}. Sip ${young ? "water" : "fluids"}.`);
      addAt(shiftLocal(date, k, 130), "recover", "Recovery snack now",
        young
          ? `Carbs plus protein within 30 minutes: ${examples(c, RECOVER, 2, "recovery")}. And water.`
          : `The first 30 minutes matter. About ${r5(1.2 * M)} g carbs plus protein, like ${examples(c, RECOVER, 2, "recovery")}. Rehydrate.`);
      addAt(shiftLocal(date, k, 230), "recover", "Recovery dinner",
        "Full plate: carbs, protein and vegetables. Keep sipping fluids.");
    }

    // Weather: heat and cold plans for each game and practice.
    for (const e of [...matches, ...practices]) {
      const wp = eventWeatherPlan(profile, e, opts.weather);
      if (!wp || wp.severity === "none") continue;
      const t = eventTime(e, practice);
      const what = e.type === "match" ? "game" : "practice";
      const hot = !!wp.conditions.heat && wp.conditions.heat !== "green";
      if (hot) {
        addAt(shiftLocal(date, t, -240), "hydrate", `Heat plan: ${wp.conditions.headline}`,
          `${kid ? `${first}'s` : "Your"} ${what} at ${to12(t)} will be hot. Drink about ${wp.preHydrateMl} ml (${cups(wp.preHydrateMl)}) now.${wp.warnings[0] && /policy|coach/.test(wp.warnings[0]) ? " " + wp.warnings[0] : ""}`);
        addAt(shiftLocal(date, t, -40), "hydrate", "Pre-cool",
          `Something ice-cold now: ${examples(cg, ["slushie", "freeze_pops", "cold_grapes", "watermelon"], 2, "cooling")}. Shade until warm-up.`);
      } else {
        addAt(shiftLocal(date, t, -120), "fuel", `Cold ${what}: ${wp.conditions.headline}`,
          `Pack: ${wp.packing.slice(0, 3).map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(", ")}. Fill the thermos with ${examples(c, ["broth", "herbal_tea", "hot_cocoa"], 1, "warm", "a warm drink")}.`);
      }
      if (e === matches[0] || (!matches.length && e === practices[0])) {
        if (hot) add(addDays(date, -1), "20:30", "hydrate", "Hot game tomorrow", `Freeze a water bottle tonight and drink an extra bottle before bed.${kid ? ` Pack ${first}'s cooler.` : ""}`);
      }
    }

    if (!matches.length) {
      for (const p of practices) {
        const t = /T\d{2}:\d{2}/.test(p.startTime) ? eventTime(p) : practice;
        const len = profile.training?.avgSessionMinutes || 90;
        addAt(shiftLocal(date, t, -75), "fuel", kid ? `Snack before ${first}'s practice` : "Pre-practice snack",
          `Practice at ${to12(t)}. A carb snack now, like ${examples(c, ["banana", "toast", "gf_toast", "rice_cakes", "crackers", "grapes"], 2, "snack")}, plus water.`);
        addAt(shiftLocal(date, t, len + 20), "recover", "Refuel after practice",
          `Carbs and protein within the hour: ${examples(c, RECOVER, 3, "recovery")}.`);
      }
    }

    if (matches.length || practices.length) {
      for (const hm of ["10:30", "13:30"]) {
        const clash = out.some((r) => r.at.slice(0, 10) === date && Math.abs(toMin(r.at.slice(11)) - toMin(hm)) < 45);
        if (!clash && toMin(hm) > toMin(wake) + 60) add(date, hm, "hydrate", "Water check",
          kid ? `Make sure ${first} has a full water bottle today.` : band.id === "masters" || band.id === "veteran"
            ? "Drink on a schedule, not just when thirsty. Finish a bottle before your next reminder."
            : "Finish a bottle before your next reminder. Pale-yellow urine is the goal.");
      }
    }

    if (matchTomorrow && !matches.length) {
      add(date, "18:00", "fuel", "Game tomorrow: carb dinner",
        `Make carbs the centre of the plate tonight: ${examples(c, ["rice", "pasta", "gf_pasta", "potato", "sweet_potato"], 2, "meal_carb")}. Kickoff tomorrow at ${to12(eventTime(matchTomorrow))}.`);
    }

    const windDown = fromMin(snap15(toMin(bed) - 45));
    const tmr = matchTomorrow ? gameMorning(eventTime(matchTomorrow), wake) : null;
    add(date, windDown, "sleep",
      matchTomorrow ? "Big day tomorrow: wind down" : "Wind down",
      matchTomorrow
        ? `Screens off, kit laid out, lights out by ${to12(bed)}.${tmr?.earlyAlarm ? ` Set ${your} alarm for ${to12(tmr.wake)}.` : ""} Sleep is part of the prep.`
        : `Lights out by ${to12(bed)}. ${kid ? `${first} needs` : "Aim for"} ${sleepLo}-${sleepHi} hours.`);
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
