/**
 * Weather tests: NJSIAA flag boundaries, cold levels, and that heat and cold
 * actually change targets, timelines, reminders, recovery and grocery lists.
 */

import type { AthleteProfile, ProfileInput } from "../src/domain/profile.js";
import { coldLevel, heatFlag, summarize, weatherPlan, dayWeatherPlan, type WeatherHour, type WeatherIndex } from "../src/domain/weather.js";
import { dailyTargets, buildToday } from "../src/domain/daily.js";
import { buildGameDayTimeline } from "../src/domain/timeline.js";
import { buildReminders } from "../src/domain/reminders.js";
import { buildGroceryList } from "../src/domain/grocery.js";
import { buildRecoveryPlan } from "../src/domain/recovery.js";
import { buildMatchDayPlan } from "../src/domain/plan.js";
import { eventWeatherPlan } from "../src/domain/weather.js";
import { addDays } from "../src/domain/dates.js";
import { isKnownZip, zipToLatLon } from "../src/weather/nws.js";
import { validateProfileInput, validateEventInputs } from "../src/domain/validation.js";

let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = "") => { if (c) passed++; else { failed++; console.log(`  FAIL  ${n}${d ? ": " + d : ""}`); } };

// --- NJSIAA WBGT flags (°F) ---
for (const [w, f] of [[79.9, "green"], [80, "yellow"], [85, "yellow"], [85.1, "orange"], [88, "orange"], [88.1, "red"], [90, "red"], [90.1, "black"]] as const) {
  check(`WBGT ${w} -> ${f}`, heatFlag(w) === f);
}
check("no WBGT -> no flag", heatFlag(null) === null);
for (const [t, l] of [[55, "none"], [50, "cool"], [39, "cold"], [24, "very_cold"], [9, "extreme"]] as const) check(`feels ${t}F -> ${l}`, coldLevel(t) === l);

// --- ZIP lookup ---
check("ZIP 07039 is Livingston area", !!zipToLatLon("07039") && Math.abs(zipToLatLon("07039")![0] - 40.79) < 0.05);
check("unknown ZIP rejected", !isKnownZip("00000") && isKnownZip("08540"));

// --- Synthetic forecast: home 07039, away field 08540 ---
const START = "2026-10-05";
type Day = { temp: number; feels: number; wbgt: number; rain?: number };
function hoursFor(days: Record<number, Day>, base: Day): WeatherHour[] {
  const out: WeatherHour[] = [];
  for (let d = 0; d < 14; d++) for (let h = 0; h < 24; h++) {
    const x = days[d] || base;
    out.push({ time: `${addDays(START, d)}T${String(h).padStart(2, "0")}:00`, tempF: x.temp, feelsF: x.feels, humidity: 60, wbgtF: x.wbgt, windMph: 8, precipPct: x.rain ?? 10 });
  }
  return out;
}
const mild: Day = { temp: 68, feels: 68, wbgt: 64 };
const wx: WeatherIndex = { byZip: {
  "07039": { place: "Roseland, NJ", hours: hoursFor({ 5: { temp: 94, feels: 103, wbgt: 86.5 }, 12: { temp: 24, feels: 14, wbgt: 20, rain: 60 } }, mild) },
  "08540": { place: "Princeton, NJ", hours: hoursFor({ 6: { temp: 97, feels: 108, wbgt: 89 } }, mild) },
} };

function athlete(dob: string, kg: number, nutrition: Partial<AthleteProfile["nutrition"]> = {}): AthleteProfile {
  const input: ProfileInput = {
    timezone: "America/New_York",
    identity: { fullName: "Sam Test", dateOfBirth: dob, sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 170, bodyMassKg: kg },
    routine: { wakeTime: "07:00", bedTime: "22:00", homeZip: "07039" },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [], ...nutrition } as AthleteProfile["nutrition"],
    schedule: { events: [
      { type: "match", startTime: `${addDays(START, 5)}T15:00`, importance: "high" },                 // hot, home
      { type: "match", startTime: `${addDays(START, 6)}T14:00`, importance: "high", zip: "08540" },  // very hot, away
      { type: "training", startTime: `${addDays(START, 2)}T17:00`, importance: "normal" },            // mild
      { type: "match", startTime: `${addDays(START, 12)}T11:00`, importance: "high" },                // very cold
    ] },
  };
  const v = validateProfileInput(input);
  if (!v.valid) throw new Error(JSON.stringify(v.errors));
  return { ...input, id: "wx-test-0000", ownerId: "o", createdAt: "", updatedAt: "" } as AthleteProfile;
}

const teen = athlete("2009-06-01", 65);
const kid = athlete("2016-06-01", 30);

// --- event matching ---
const hot = eventWeatherPlan(teen, teen.schedule!.events[0], wx)!;
const away = eventWeatherPlan(teen, teen.schedule!.events[1], wx)!;
const cold = eventWeatherPlan(teen, teen.schedule!.events[3], wx)!;
const mildP = eventWeatherPlan(teen, teen.schedule!.events[2], wx)!;
check("home game uses home ZIP, orange flag", hot.conditions.zip === "07039" && hot.conditions.heat === "orange", hot.conditions.headline);
check("away game uses the field's ZIP, red flag", away.conditions.zip === "08540" && away.conditions.heat === "red" && away.conditions.place === "Princeton, NJ");
check("cold game: very cold level", cold.conditions.cold === "very_cold", cold.conditions.headline);
check("mild practice: no severity", mildP.severity === "none");
check("red flag cites the NJ 1-hour practice limit", away.warnings.some((w) => /1 hour/.test(w)));
check("heat-illness warning signs included", hot.warnings.some((w) => /911/.test(w)));
check("pre-hydration scales with weight (65 kg orange -> 460 ml)", hot.preHydrateMl === 460, String(hot.preHydrateMl));
check("black flag says no outdoor workouts", weatherPlan(summarize("07039", [{ time: "2026-10-05T12:00", tempF: 100, feelsF: 110, humidity: 70, wbgtF: 92, windMph: 3, precipPct: 0 }], "2026-10-05T12:00", "2026-10-05T12:00")!, { M: 60, kid: false, young: false, durationMin: 90 }).warnings.some((w) => /NO outdoor/.test(w)));

// --- targets change ---
const hotDay = dailyTargets(teen, addDays(START, 5), undefined, wx);
const hotDayNoWx = dailyTargets(teen, addDays(START, 5));
check("hot game day raises fluid target", hotDay.fluidsL > hotDayNoWx.fluidsL + 0.5, `${hotDayNoWx.fluidsL} -> ${hotDay.fluidsL}`);
const coldDay = dailyTargets(teen, addDays(START, 12), undefined, wx);
const coldNoWx = dailyTargets(teen, addDays(START, 12));
check("very cold game day raises carbs", coldDay.carbsG[0] > coldNoWx.carbsG[0], `${coldNoWx.carbsG} -> ${coldDay.carbsG}`);
const today = buildToday(teen, addDays(START, 5), null, wx);
check("Today puts the heat plan first", /Hot:/.test(today.focus[0]) && today.weather.events.length === 1, today.focus[0]);
check("no ZIP / no forecast -> plans still work", buildToday(teen, addDays(START, 5), null).weather.day === null);

// --- timeline ---
const tl = buildGameDayTimeline(teen, { date: addDays(START, 5), kickoff: "15:00", weather: hot });
check("hot timeline adds pre-hydrate at 11:00", tl.entries.some((e) => e.phase === "Pre-hydrate" && e.time === "11:00"));
check("hot timeline adds pre-cool", tl.entries.some((e) => e.phase === "Pre-cool"));
check("hot half-time: shade, cold towels, electrolytes", /cold towels/.test(tl.entries.find((e) => e.phase === "Half-time")!.detail));
check("timeline stays in time order", tl.entries.slice(0, -2).every((e, i, a) => i === 0 || a[i - 1].time <= e.time));
const tlc = buildGameDayTimeline(teen, { date: addDays(START, 12), kickoff: "11:00", weather: cold });
check("cold timeline: longer warm-up", tlc.entries.some((e) => e.phase === "Warm-up" && /min/.test(e.title)));
check("cold half-time: warm drink from a thermos", /thermos/.test(tlc.entries.find((e) => e.phase === "Half-time")!.detail));
check("cold recovery: dry clothes", /Dry, warm clothes/.test(tlc.entries.find((e) => e.phase === "Immediate recovery")!.detail));
const early = buildGameDayTimeline(teen, { date: addDays(START, 5), kickoff: "09:00", weather: hot });
check("early hot game: pre-hydrate never before wake-up", early.entries.find((e) => e.phase === "Pre-hydrate")!.time >= "07:00");
const kidTl = buildGameDayTimeline(kid, { date: addDays(START, 5), kickoff: "15:00", weather: eventWeatherPlan(kid, kid.schedule!.events[0], wx) });
check("kid hot game: in-game fluid in kid ranges", /0\.5–0\.7 L/.test(kidTl.entries.find((e) => e.phase === "Kickoff")!.detail));

// --- match-day plan, reminders, recovery, grocery ---
const plan = buildMatchDayPlan(teen, { date: addDays(START, 5), kickoff: "15:00", assumedKickoff: false, weather: hot });
check("match-day plan gets a Weather block", plan.blocks.some((b) => b.phase === "Weather") && plan.safety.warnings.some((w) => /2 hours/.test(w)));
const rem = buildReminders(teen, { from: START, days: 14, weather: wx });
check("reminder: heat plan 4 h before the hot game", rem.some((r) => r.at === `${addDays(START, 5)}T11:00` && /Heat plan/.test(r.title)));
check("reminder: pre-cool before the hot game", rem.some((r) => r.title === "Pre-cool" && r.at.startsWith(addDays(START, 5))));
check("reminder: freeze a bottle the night before", rem.some((r) => r.title === "Hot game tomorrow" && r.at.startsWith(addDays(START, 4))));
check("reminder: cold-game packing list", rem.some((r) => /Cold game/.test(r.title) && /gloves|layer/i.test(r.body)));
const kidRem = buildReminders(kid, { from: START, days: 7, weather: wx });
check("kid heat reminder speaks to the parent", kidRem.some((r) => /Sam's game/.test(r.body)));
const g1 = buildGroceryList(teen, START, 7, wx);
check("hot week grocery: freeze pops and electrolytes", g1.sections.some((s) => /heat/.test(s.title) && s.items.some((i) => /Freeze pops/.test(i.name))));
const g2 = buildGroceryList(teen, addDays(START, 7), 7, wx);
check("cold week grocery: warm drink and hand warmers", g2.sections.some((s) => /cold/.test(s.title) && s.items.some((i) => /Hand warmers/.test(i.name))));
const dairy = athlete("2009-06-01", 65, { allergies: [{ allergen: "milk", severity: "severe" }] });
check("cold week + milk allergy: no hot cocoa", !JSON.stringify(buildGroceryList(dairy, addDays(START, 7), 7, wx)).toLowerCase().includes("cocoa"));
const rec = buildRecoveryPlan(teen, { today: addDays(START, 7), weather: wx });
check("recovery notes the heat of each game", rec.days.some((d) => d.actions.some((a) => /Rehydrate with electrolytes/.test(a))));
check("recovery window after the hot game starts with heat steps", rec.windows.some((w) => /It was hot/.test(w.steps[0])));

// --- validation ---
check("bad home ZIP rejected", !validateProfileInput({ ...teen, routine: { homeZip: "7039" } } as ProfileInput).valid);
check("bad event ZIP rejected", !validateEventInputs([{ type: "match", startTime: "2026-10-01T10:00", zip: "ABCDE" }]).valid);

console.log(`Weather tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
void dayWeatherPlan;
