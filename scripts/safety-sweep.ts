/**
 * Food-safety sweep.
 *
 * For every allergy, diet, intolerance, medical diet, free-text exclusion and
 * age program, build EVERY output the app produces (match-day plan, game-day
 * timelines incl. early kickoffs and back-to-back games, tournament recovery,
 * 14 days of reminders, grocery list, Today for two weeks, My Program) and
 * fail if any unsafe food, or a word that implies one, appears anywhere.
 *
 *   npm test   (runs after the main suite)
 */

import type { AthleteProfile, ProfileInput } from "../src/domain/profile.js";
import { buildMatchDayPlan } from "../src/domain/plan.js";
import { buildGameDayTimeline } from "../src/domain/timeline.js";
import { buildRecoveryPlan } from "../src/domain/recovery.js";
import { buildReminders } from "../src/domain/reminders.js";
import { buildGroceryList } from "../src/domain/grocery.js";
import { buildToday } from "../src/domain/daily.js";
import { buildProgram } from "../src/domain/program.js";
import { FOODS, isSafe, safetyContext } from "../src/domain/foods.js";
import { bandForAge } from "../src/domain/ageBands.js";
import { addDays } from "../src/domain/dates.js";
import { validateProfileInput } from "../src/domain/validation.js";
import { eventWeatherPlan, type WeatherHour, type WeatherIndex } from "../src/domain/weather.js";

let passed = 0;
let failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else { failed++; fails.push(`${name}${detail ? `: ${detail}` : ""}`); }
}

const START = "2026-10-05"; // a Monday
type Nut = AthleteProfile["nutrition"];

function athlete(dob: string, nutrition: Partial<Nut>, kg = 60): AthleteProfile {
  const input: ProfileInput = {
    timezone: "America/New_York",
    identity: { fullName: "Test Player", dateOfBirth: dob, sex: "female" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 150, bodyMassKg: kg },
    training: { avgSessionMinutes: 90 },
    routine: { wakeTime: "07:00", bedTime: "21:30", usualPracticeTime: "17:00", homeZip: "07039" },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [], ...nutrition } as Nut,
    schedule: {
      events: [
        { type: "training", startTime: `${addDays(START, 1)}T17:00`, importance: "normal" },
        { type: "training", startTime: `${addDays(START, 3)}T17:00`, importance: "normal" },
        { type: "match", startTime: `${addDays(START, 5)}T08:00`, importance: "high" },   // very early
        { type: "match", startTime: `${addDays(START, 5)}T13:00`, importance: "high" },   // same-day double
        { type: "match", startTime: `${addDays(START, 6)}T10:00`, importance: "high" },   // next morning
        { type: "match", startTime: `${addDays(START, 12)}T19:00`, importance: "high" },
      ],
    },
  };
  const v = validateProfileInput(input);
  if (!v.valid) throw new Error("fixture invalid: " + JSON.stringify(v.errors));
  return { ...input, id: "00000000-test", ownerId: "o", createdAt: "", updatedAt: "" } as AthleteProfile;
}

// Weather for the sweep: a heat wave on the tournament weekend, a cold snap on day 12.
function wxHours(): WeatherHour[] {
  const out: WeatherHour[] = [];
  for (let d = 0; d < 14; d++) for (let h = 0; h < 24; h++) {
    const hot = d === 5 || d === 6, cold = d === 12 || d === 13;
    out.push({ time: `${addDays(START, d)}T${String(h).padStart(2, "0")}:00`, tempF: hot ? 95 : cold ? 22 : 66, feelsF: hot ? 105 : cold ? 12 : 66, humidity: 60, wbgtF: hot ? 88.5 : cold ? 18 : 62, windMph: 10, precipPct: cold ? 60 : 5 });
  }
  return out;
}
const WX: WeatherIndex = { byZip: { "07039": { place: "Roseland, NJ", hours: wxHours() } } };

/** Drop "avoid" lists: they're SUPPOSED to name the allergen ("Always avoiding: peanut"). */
const noAvoidLists = (_k: string, v: unknown) => (_k === "safety" || _k === "avoid" ? undefined : v);

/** Everything the app can show for this athlete, as one string. */
function allText(p: AthleteProfile, withProgram = true): string {
  const out: unknown[] = [];
  for (const d of [5, 6, 12]) {
    const date = addDays(START, d);
    const k = d === 5 ? "08:00" : d === 6 ? "10:00" : "19:00";
    const ev = (p.schedule?.events || []).find((e) => e.startTime === `${date}T${k}`);
    const weather = ev ? eventWeatherPlan(p, ev, WX) : null;
    for (const w of [null, weather]) {
      out.push(buildMatchDayPlan(p, { date, kickoff: k, assumedKickoff: false, weather: w }));
      out.push(buildGameDayTimeline(p, { date, kickoff: k, wakeTime: "07:00", bedTime: "21:30", playsTomorrow: d === 5, weather: w }));
    }
  }
  // A cold-weather game too (day 12 is cold in the sweep forecast).
  const coldGame = { type: "match" as const, startTime: `${addDays(START, 12)}T19:00`, importance: "high" as const };
  out.push(buildGameDayTimeline(p, { date: addDays(START, 12), kickoff: "19:00", weather: eventWeatherPlan(p, coldGame, WX) }));
  out.push(buildMatchDayPlan(p, { date: addDays(START, 12), kickoff: "19:00", assumedKickoff: false, weather: eventWeatherPlan(p, coldGame, WX) }));
  out.push(buildGameDayTimeline(p, { date: addDays(START, 5), kickoff: "13:00", playsTomorrow: true }));
  for (const weather of [undefined, WX]) {
    out.push(buildRecoveryPlan(p, { today: addDays(START, 7), weather }));
    out.push(buildRecoveryPlan(p, { today: addDays(START, 13), weather }));
    out.push(buildReminders(p, { from: START, days: 14, weather }));
    out.push(buildGroceryList(p, START, 7, weather));
    out.push(buildGroceryList(p, addDays(START, 7), 7, weather));
    for (let i = 0; i < 14; i++) out.push(buildToday(p, addDays(START, i), null, weather));
  }
  // The program's safety summary and "avoid" lists intentionally name excluded foods; scan the rest.
  if (withProgram) out.push(buildProgram(p));
  return JSON.stringify(out, noAvoidLists);
}

/** Remove every safe food name first, so "gluten-free pasta" doesn't trip "pasta". */
function scrub(text: string, p: AthleteProfile): string {
  const c = safetyContext(p);
  let t = text.toLowerCase();
  const safeNames = FOODS.filter((f) => isSafe(f, c)).map((f) => f.name.toLowerCase()).sort((a, b) => b.length - a.length);
  for (const n of safeNames) t = t.split(n).join(" ");
  // Neutral phrases that contain trigger words but aren't foods.
  for (const phrase of ["gluten-free", "lactose-free", "dairy-free", "nut-free", "caffeine-free", "sports drink", "non-negotiable", "protein snack you tolerate", "proteins you tolerate", "calcium-fortified", "iron-fortified", "epinephrine", "gluten-free bread"].sort((a, b) => b.length - a.length))
    t = t.split(phrase.toLowerCase()).join(" ");
  return t;
}

const WORDS: Record<string, RegExp> = {
  peanut: /peanut/,
  tree_nut: /almond|cashew|walnut|pecan|hazelnut|pistachio/,
  milk: /yogurt|whey|cheese|\bmilk\b|dairy|cottage|cocoa/,
  egg: /\beggs?\b/,
  wheat: /pasta|bread|bagel|toast|pretzel|cracker|sandwich|couscous|noodle/,
  gluten: /pasta|bread|bagel|toast|pretzel|cracker|sandwich|couscous|noodle/,
  soy: /\bsoy\b|tofu|edamame/,
  fish: /salmon|tuna|\bfish\b|sardine/,
  shellfish: /shrimp|shellfish/,
  sesame: /sesame|hummus/,
};

interface Case { name: string; nut: Partial<Nut>; words: RegExp[] }
const cases: Case[] = [
  ...Object.keys(WORDS).map((a) => ({
    name: `allergy:${a}`,
    nut: { allergies: [{ allergen: a as never, severity: "severe" as const, avoidCrossContact: true }] },
    words: [WORDS[a]],
  })),
  { name: "diet:vegan", nut: { dietaryRestrictions: ["vegan"] }, words: [/chicken|beef|turkey|salmon|tuna|\bfish\b|shrimp|\beggs?\b|yogurt|\bmilk\b|cheese|whey|honey|chews|cocoa/] },
  { name: "diet:vegetarian", nut: { dietaryRestrictions: ["vegetarian"] }, words: [/chicken|beef|turkey|salmon|tuna|shrimp|chews/] },
  { name: "free-text: broth", nut: { dislikes: ["broth"] }, words: [/broth/] },
  { name: "diet:pescatarian", nut: { dietaryRestrictions: ["pescatarian"] }, words: [/chicken|beef|turkey|chews/] },
  { name: "diet:halal", nut: { dietaryRestrictions: ["halal"] }, words: [/pork|chews|gelatin/] },
  { name: "diet:kosher", nut: { dietaryRestrictions: ["kosher"] }, words: [/pork|chews|shrimp|shellfish/] },
  { name: "diet:no_red_meat", nut: { dietaryRestrictions: ["no_red_meat"] }, words: [/beef/] },
  { name: "diet:dairy_free", nut: { dietaryRestrictions: ["dairy_free"] }, words: [WORDS.milk] },
  { name: "diet:gluten_free", nut: { dietaryRestrictions: ["gluten_free"] }, words: [WORDS.gluten] },
  { name: "diet:nut_free", nut: { dietaryRestrictions: ["nut_free"] }, words: [/peanut|almond|cashew|walnut/] },
  { name: "intolerance:lactose", nut: { intolerances: ["lactose"] }, words: [/greek yogurt|chocolate milk|cottage|cheese|(?<!lactose-free |soy )\bmilk\b/] },
  { name: "intolerance:fructose", nut: { intolerances: ["fructose"] }, words: [/honey|\bapple|raisin|dried fruit/] },
  { name: "medical:celiac", nut: { medicalDiets: ["celiac"] }, words: [WORDS.gluten, /oatmeal|\boats\b/] },
  { name: "medical:low_fodmap", nut: { medicalDiets: ["low_fodmap"] }, words: [/honey|\bapple|lentil|\bbeans\b|hummus|greek yogurt|chocolate milk/] },
  { name: "free-text allergy: banana", nut: { allergies: [{ allergen: "other", severity: "moderate", note: "banana" }] }, words: [/banana/] },
  { name: "dislikes: fish, eggs", nut: { dislikes: ["fish", "eggs"] }, words: [/salmon|tuna|\bfish\b|\beggs?\b/] },
  { name: "combo: vegan + peanut + gluten-free", nut: { dietaryRestrictions: ["vegan", "gluten_free"], allergies: [{ allergen: "peanut", severity: "severe" }] }, words: [/peanut|chicken|yogurt|\bmilk\b|pasta|bagel|toast|honey/] },
];

const AGES: [string, string][] = [
  ["2019-01-15", "7"], ["2014-01-15", "12"], ["2010-01-15", "16"], ["2004-01-15", "22"],
  ["1997-01-15", "29"], ["1986-01-15", "40"], ["1970-01-15", "56"],
];

for (const [dob, age] of AGES) {
  for (const k of cases) {
    const p = athlete(dob, k.nut, Number(age) < 12 ? 30 : 62);
    const text = scrub(allText(p), p);
    // 1) No catalog food that is unsafe for this athlete appears by name.
    const c = safetyContext(p);
    const leaked = FOODS.filter((f) => !isSafe(f, c)).map((f) => f.name.toLowerCase()).filter((n) => text.includes(n));
    check(`age ${age} ${k.name}: no unsafe catalog food`, leaked.length === 0, leaked.join(", "));
    // 2) No word that implies the restricted food.
    for (const w of k.words) {
      const m = text.match(w);
      check(`age ${age} ${k.name}: no ${w}`, !m, m ? `found "${m[0]}" near "${text.slice(Math.max(0, (m.index || 0) - 60), (m.index || 0) + 40)}"` : "");
    }
  }
  // Age rules on a profile with no restrictions.
  const p = athlete(dob, {}, Number(age) < 12 ? 30 : 62);
  const text = allText(p, false).toLowerCase();
  const band = bandForAge(Number(age));
  if (Number(age) < 15) {
    check(`age ${age}: no gels or chews`, !/\bgels?\b|energy chews/.test(text), (text.match(/.{60}(\bgels?\b|energy chews).{30}/) || [""])[0]);
    check(`age ${age}: no protein powders`, !/whey protein|pea protein|protein shake|protein powder/.test(text), (text.match(/.{60}(whey protein|pea protein|protein shake|protein powder).{30}/) || [""])[0]);
  }
  if (Number(age) < 13) check(`age ${age}: reminders speak to the parent`, buildReminders(p, { from: START, days: 7 }).some((r) => /Test's|for Test/.test(r.title + r.body)));
  check(`age ${age}: program is ${band.name}`, buildProgram(p).band.id === band.id);
}

// The sweep must really be scanning weather text.
{
  const t = allText(athlete("1997-01-15", {}, 70)).toLowerCase();
  check("sweep covers heat plans", t.includes("pre-cool") && t.includes("heat flag"));
  check("sweep covers cold plans", t.includes("thermos") && t.includes("very cold"));
}

// Program boundaries: no gaps, no overlaps.
for (const [age, id] of [[6, "foundations"], [9, "foundations"], [10, "growth"], [14, "growth"], [15, "development"], [18, "development"], [19, "performance"], [24, "performance"], [25, "prime"], [32, "prime"], [33, "veteran"], [45, "veteran"], [46, "masters"], [70, "masters"]] as const) {
  check(`age ${age} -> ${id}`, bandForAge(age).id === id);
}

// Programs really differ: sleep, protein per meal, in-game, recovery length.
{
  const kid = buildProgram(athlete("2019-01-15", {}, 25));
  const teen = buildProgram(athlete("2010-01-15", {}, 60));
  const adult = buildProgram(athlete("1997-01-15", {}, 75));
  const master = buildProgram(athlete("1970-01-15", {}, 75));
  check("kids sleep 9-12 h, adults 7-9 h", kid.numbers.sleepHours[0] === 9 && adult.numbers.sleepHours[1] === 9);
  check("masters get more protein per meal than prime (same weight)", master.numbers.proteinPerMealG > adult.numbers.proteinPerMealG);
  check("kids: water and fruit in games; teens: sports fuel", /Water/.test(kid.rules.inGame) && /gels/.test(teen.rules.inGame));
  check("kids: no caffeine; teens: avoid; adults: optional", /No caffeine/.test(kid.rules.caffeine) && /Avoid/.test(teen.rules.caffeine) && /Optional/.test(adult.rules.caffeine));
  const recA = buildRecoveryPlan(athlete("1997-01-15", {}, 75), { today: addDays(START, 13) });
  const recM = buildRecoveryPlan(athlete("1970-01-15", {}, 75), { today: addDays(START, 13) });
  check("masters recovery plan runs an extra day", recM.days.length === recA.days.length + 1);
  const todayKid = buildToday(athlete("2019-01-15", {}, 25), addDays(START, 2), null);
  check("kids' targets shown as plates", todayKid.targets.mode === "plates" && /carbs/.test(todayKid.targets.plate));
}

// Sleep window vs age need.
{
  const kid = athlete("2018-01-15", {}, 25);
  kid.routine = { wakeTime: "07:00", bedTime: "22:30" };
  const t = buildToday(kid, addDays(START, 2), null);
  const sw = t.focus.find((f) => /needs at least 9 hours/.test(f)) || "";
  check("kid with a 10:30 PM bedtime gets a sleep warning with a better bedtime", /9:30 PM/.test(sw), t.focus.join(" | "));
  const adult = athlete("1997-01-15", {}, 75);
  adult.routine = { wakeTime: "07:00", bedTime: "22:30" };
  check("adult with 8.5 h window gets no sleep warning", !buildToday(adult, addDays(START, 2), null).focus.some((f) => /need at least/.test(f)));
  check("kids' protein shown as a portion, not grams", buildProgram(athlete("2018-01-15", {}, 25)).numbers.proteinPerMealText === "a palm-size portion");
}

// Safety summary and warnings.
{
  const p = athlete("2012-01-15", {
    allergies: [{ allergen: "peanut", severity: "severe", anaphylaxis: true, epinephrine: true, avoidCrossContact: true }, { allergen: "other", severity: "moderate", note: "kiwi" }],
    medicalDiets: ["type1_diabetes", "celiac"],
  }, 40);
  const s = buildProgram(p).safety;
  check("EpiPen warning present", s.warnings.some((w) => /epinephrine/i.test(w)));
  check("type 1 diabetes warning present", s.warnings.some((w) => /diabetes care team/.test(w)));
  check("free-text allergy flagged for label reading", s.warnings.some((w) => /kiwi/.test(w)) && s.labelCheck.includes("kiwi"));
  check("excluded list explains why", s.excluded.some((e) => e.name === "peanut butter" && /peanut/.test(e.why)));
  const reminders = buildReminders(p, { from: START, days: 7 });
  check("game-day packing reminder includes the EpiPen", reminders.some((r) => /EpiPen/.test(r.body)));
  const bad = validateProfileInput({ ...p, nutrition: { ...p.nutrition, medicalDiets: ["keto"] as never } } as ProfileInput);
  check("unknown medical diet rejected", !bad.valid);
}

console.log(`Safety sweep: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of fails.slice(0, 40)) console.log("  FAIL  " + f);
  process.exit(1);
}
