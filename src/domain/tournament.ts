/**
 * Tournament-weekend planner (pure): 2+ games within 48 hours.
 * Fueling between games by the size of the gap, a cooler list sized to the
 * weekend, hotel tips, and a food-search link near each field.
 */

import type { AthleteProfile, ScheduledEvent } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { parentVoice } from "./ageBands.js";
import { addDays, eventDate, eventTime, fromMin, routineOf, shortDate, sortedEvents, to12, toMin } from "./dates.js";
import { examples, safetyContext } from "./foods.js";
import { durationOf } from "./weather.js";

export interface TournamentGame { date: string; label: string; time: string; title?: string; zip?: string; endsAt: string }
export interface Gap { after: string; before: string; minutes: number; plan: string[] }
export interface TournamentPlan {
  start: string;
  end: string;
  games: TournamentGame[];
  gaps: Gap[];
  cooler: string[];
  hotel: string[];
  foodNearField: { zip: string; url: string }[];
  nightBefore: string[];
}

const abs = (e: ScheduledEvent, practice: string) => {
  const d = eventDate(e);
  return Date.parse(`${d}T00:00:00Z`) / 60000 + toMin(eventTime(e, practice));
};

/** Upcoming tournament weekends from `today` over the next `days`. */
export function tournamentPlans(profile: AthleteProfile, today: string, days = 21): TournamentPlan[] {
  const r = routineOf(profile);
  const games = sortedEvents(profile).filter((e) => (e.type === "match" || e.type === "tournament") && eventDate(e) >= today && eventDate(e) <= addDays(today, days) && e.startTime.length > 10);
  const groups: ScheduledEvent[][] = [];
  for (const g of games) {
    const last = groups[groups.length - 1];
    if (last && abs(g, r.practice) - abs(last[last.length - 1], r.practice) <= 48 * 60) last.push(g);
    else groups.push([g]);
  }
  const c = safetyContext(profile, { gameDay: true });
  const kid = parentVoice(effectiveAge(profile.identity));
  return groups.filter((g) => g.length >= 2).map((grp) => {
    const list: TournamentGame[] = grp.map((e) => {
      const end = toMin(eventTime(e, r.practice)) + durationOf(profile, e);
      return { date: eventDate(e), label: shortDate(eventDate(e)), time: to12(eventTime(e, r.practice)), title: e.title, zip: e.zip || profile.routine?.homeZip, endsAt: to12(fromMin(end)) };
    });
    const gaps: Gap[] = [];
    for (let i = 1; i < grp.length; i++) {
      const a = grp[i - 1], b = grp[i];
      const gap = abs(b, r.practice) - (abs(a, r.practice) + durationOf(profile, a));
      const plan: string[] = [];
      if (gap < 0) plan.push("These games overlap. Check the schedule with the coach.");
      else if (gap < 60) plan.push(`Under an hour: sip a sports drink and eat a few bites of ${examples(c, ["orange", "banana", "grapes", "applesauce"], 2, "halftime")}. Nothing heavy.`);
      else if (gap < 120) plan.push(`1 to 2 hours: a small carb snack right away, like ${examples(c, ["banana", "bagel", "rice_cakes", "pretzels"], 2, "quick_carb")}, plus water.`);
      else if (gap < 240) plan.push(`2 to 4 hours: a light meal soon after the game: ${examples(c, ["turkey_sandwich", "bagel", "rice_bowl", "tofu_bowl", "banana"], 2)}. Then a small snack an hour before the next game.`);
      else if (gap < 12 * 60) plan.push(`Long break: a full lunch or dinner with carbs and protein, then rest with legs up. Snack 1 hour before the next game.`);
      else plan.push("Overnight: recovery dinner, a protein snack before bed, and a full carb breakfast 3 hours before the first game.");
      if (gap >= 60 && gap < 12 * 60) plan.push("Get out of the sun, change into dry socks, and keep drinking.");
      gaps.push({ after: `${shortDate(eventDate(a))} ${to12(eventTime(a, r.practice))}`, before: `${shortDate(eventDate(b))} ${to12(eventTime(b, r.practice))}`, minutes: Math.max(0, gap), plan });
    }
    const n = grp.length;
    const cooler = [
      `Water: ${n + 2} bottles, one frozen`,
      `Sports drink: ${n} bottles`,
      `Quick carbs for between games: ${examples(c, ["banana", "orange", "grapes", "applesauce", "pretzels", "rice_cakes"], 4, "halftime")}`,
      `Recovery snack for after each game: ${examples(c, ["choc_milk", "greek_yogurt", "turkey_sandwich", "soy_milk", "plant_shake", "rice_bowl"], 2, "recovery")} (${n} servings)`,
      "Ice packs and a small towel",
    ];
    if ((profile.nutrition.allergies || []).some((a) => a.epinephrine)) cooler.unshift("Two EpiPens, kept out of the heat and not in the cooler's ice");
    if (profile.health?.asthma?.has) cooler.unshift("Inhaler");
    const hotel = [
      "Lights out at the usual time. Tournament nights are for sleep, not late team hangouts.",
      "Keep the pool to 20 minutes and out of the sun. It tires legs more than it feels.",
      `Stock the room: water, ${examples(c, ["banana", "bagel", "oats", "rice_cakes"], 2, "breakfast")} for breakfast in case the hotel's is late or unsafe.`,
      kid ? "Pack a night light and a familiar pillow for younger players." : "Phone away 30 minutes before bed.",
    ];
    if (c.allergens.length) hotel.push("Hotel breakfast buffets carry cross-contact risk. Bring your own safe breakfast.");
    const zips = [...new Set(list.map((g) => g.zip).filter((z): z is string => !!z))];
    return {
      start: list[0].date, end: list[list.length - 1].date, games: list, gaps, cooler, hotel,
      foodNearField: zips.map((zip) => ({ zip, url: `https://www.google.com/maps/search/${encodeURIComponent("restaurants near " + zip)}` })),
      nightBefore: [
        `Carb-rich dinner the night before: ${examples(c, ["pasta", "rice", "potato"], 2, "meal_carb")} with a lean protein.`,
        "Pack everything the night before: uniforms, cleats, shin guards, two pairs of socks per game.",
      ],
    };
  });
}
