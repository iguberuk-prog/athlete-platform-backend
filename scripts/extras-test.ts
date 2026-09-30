/**
 * Tests: streaks and badges, journal and stats, what-worked insights, early
 * warning score, tournament planner, budget, emergency card, grocery aisles,
 * position fueling, countdown, Ask the app safety.  Run: npx tsx scripts/extras-test.ts
 */

import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteCheckInRepository, SqliteRecordRepository } from "../src/data/sqliteRepository.js";
import type { AthleteProfile, ProfileInput } from "../src/domain/profile.js";
import type { DailyCheckIn } from "../src/domain/checkin.js";
import { buildProgress } from "../src/domain/progress.js";
import { seasonStats, validateGameLog, whatWorked, type GameLog } from "../src/domain/journal.js";
import { riskScore } from "../src/domain/risk.js";
import { tournamentPlans } from "../src/domain/tournament.js";
import { budgetSummary, seasonRange, validateExpense } from "../src/domain/budget.js";
import { emergencyCard } from "../src/domain/safety.js";
import { aisleFor, buildGroceryList } from "../src/domain/grocery.js";
import { dailyTargets, positionFuel } from "../src/domain/daily.js";
import { nextUp } from "../src/domain/dayplans.js";
import { mentalSkills } from "../src/domain/mental.js";
import { recipeBook } from "../src/domain/recipes.js";
import { addDays } from "../src/domain/dates.js";
import { FamilyService } from "../src/services/familyService.js";
import { PlayerService } from "../src/services/playerService.js";
import { AskService, unsafeMentions } from "../src/services/askService.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
const TODAY = "2026-10-05";
function input(dob: string, over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    timezone: "America/New_York",
    identity: { fullName: "Sam Striker", dateOfBirth: dob, sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 165, bodyMassKg: 55 },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] },
    routine: { homeZip: "07039", wakeTime: "07:00" },
    ...over,
  } as ProfileInput;
}
const prof = (dob: string, over: Partial<ProfileInput> = {}): AthleteProfile => ({ ...input(dob, over), id: "p1", ownerId: "o1", createdAt: "", updatedAt: "" });
const ci = (date: string, x: Partial<DailyCheckIn> = {}): DailyCheckIn => ({ id: date, ownerId: "o1", profileId: "p1", date, createdAt: "", ...x });
const days = (n: number, x: (i: number) => Partial<DailyCheckIn>) => Array.from({ length: n }, (_, i) => ci(addDays(TODAY, -i), x(i)));

console.log("\nStreaks and badges");
{
  const p = prof("2012-01-01");
  const cis = days(8, (i) => ({ sleepHoursLastNight: 10, urineColor: 2, warmupDone: i % 2 === 0 }));
  const pr = buildProgress(p, { checkins: cis, reflectionDates: [] }, TODAY);
  const s = (id: string) => pr.streaks.find((x) => x.id === id)!;
  check("8-day check-in streak", s("checkin").current === 8 && s("checkin").doneToday);
  check("sleep and hydration streaks", s("sleep").current === 8 && s("hydration").current === 8);
  check("badges: first step, one week, sleep champ, hydration hero", ["first", "week", "sleep7", "hyd7"].every((b) => pr.badges.find((x) => x.id === b)!.earned));
  check("no badge is about weight or body", !JSON.stringify(pr).toLowerCase().match(/weight|body|slim|lean|kg|lb/));
  const gap = buildProgress(p, { checkins: [ci(TODAY), ci(addDays(TODAY, -2))], reflectionDates: [] }, TODAY);
  check("a missed day breaks the streak", gap.streaks[0].current === 1 && gap.streaks[0].best === 1);
  const yesterday = buildProgress(p, { checkins: days(3, () => ({})).filter((c) => c.date !== TODAY), reflectionDates: [] }, TODAY);
  check("streak still alive before today's check-in", yesterday.streaks[0].current === 2 && !yesterday.streaks[0].doneToday);
}

console.log("\nJournal, stats, what worked");
{
  check("log validation", validateGameLog({ date: TODAY, type: "match", minutes: 70, goals: 1, rating: 4 }).length === 0 && validateGameLog({ date: "x", type: "nap" as never, rating: 9 }).length === 3);
  const logs: GameLog[] = [
    { id: "1", date: "2026-09-05", type: "match", minutes: 90, started: true, goals: 1, assists: 1, rating: 5, result: "win", preGameMeal: "carb_meal" },
    { id: "2", date: "2026-09-12", type: "match", minutes: 45, goals: 0, rating: 2, result: "loss", preGameMeal: "fast_food" },
    { id: "3", date: "2026-09-19", type: "match", minutes: 90, started: true, goals: 2, rating: 5, result: "win", preGameMeal: "carb_meal" },
    { id: "4", date: "2026-09-26", type: "match", minutes: 60, rating: 2, result: "draw", preGameMeal: "fast_food" },
    { id: "5", date: "2026-10-01", type: "match", minutes: 80, started: true, goals: 1, rating: 4, preGameMeal: "carb_meal" },
    { id: "6", date: "2026-10-03", type: "match", minutes: 30, rating: 2, preGameMeal: "skipped" },
    { id: "7", date: "2026-10-04", type: "training", minutes: 90 },
  ];
  const st = seasonStats(logs);
  check("stats: games, minutes, goals, starts, W-D-L", st.games === 6 && st.minutes === 395 && st.goals === 4 && st.starts === 3 && st.wins === 2 && st.draws === 1 && st.losses === 1);
  check("goals per 90", st.per90.goals === Math.round((4 / 395) * 90 * 100) / 100);
  const sleepy = logs.map((l) => ci(l.date, { sleepHoursLastNight: l.rating! >= 4 ? 9.5 : 7 }));
  const ww = whatWorked(prof("2011-01-01"), logs, sleepy);
  check("insight: best games after enough sleep", ww.insights.some((i) => /sleep/.test(i.text)));
  check("insight: carb-rich meal", ww.insights.some((i) => /carb-rich/.test(i.text)));
  check("no insights from too little data", whatWorked(prof("2011-01-01"), logs.slice(0, 3), sleepy).insights.length === 0);
}

console.log("\nEarly warning score");
{
  const p = prof("2011-01-01");
  const calm = riskScore(p, days(10, () => ({ sleepHoursLastNight: 9.5, sorenessLevel: 3, stressLevel: 3 })), TODAY);
  check("well-rested player: low", calm.level === "low" && calm.score < 25);
  const tired = days(28, (i) => ({ sleepHoursLastNight: 6.5, sorenessLevel: i < 3 ? 8 : 4, stressLevel: 8, sessionMinutes: i < 7 ? 120 : 60, sessionRpe: i < 7 ? 8 : 5, soreSpots: i < 3 ? [{ region: "hamstring_r" as const, level: 8 }] : [] }));
  const hi = riskScore(p, tired, TODAY);
  check("sleep debt + load spike + soreness + stress: high", hi.level === "high" && hi.factors.some((f) => f.id === "spike") && hi.acwr! > 1.5);
  check("high risk gives actions", hi.actions.some((a) => /Ease off/.test(a)));
}

console.log("\nTournament planner");
{
  const p = prof("2011-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] }, schedule: { events: [
    { type: "match", startTime: "2026-10-10T08:00:00-04:00", importance: "high", zip: "08540" },
    { type: "match", startTime: "2026-10-10T11:00:00-04:00", importance: "high", zip: "08540" },
    { type: "match", startTime: "2026-10-11T09:00:00-04:00", importance: "high", zip: "08540" },
    { type: "match", startTime: "2026-10-25T10:00:00-04:00", importance: "high" },
  ] } });
  const tp = tournamentPlans(p, TODAY);
  check("one weekend with 3 games (lone game later is not a tournament)", tp.length === 1 && tp[0].games.length === 3);
  check("gap after 8 AM game (ends ~9:50, next 11:00) = snack plan", /1 to 2 hours/.test(tp[0].gaps[0].plan[0]));
  check("overnight gap plan", /Overnight/.test(tp[0].gaps[1].plan[0]));
  check("cooler: EpiPens first, no peanut", /EpiPen/.test(tp[0].cooler[0]) && !/peanut/i.test(tp[0].cooler.join(" ")));
  check("food search link near the field", tp[0].foodNearField[0].url.includes("08540"));
}

console.log("\nBudget, emergency card, aisles, position, countdown, mental");
{
  check("expense validation", validateExpense({ date: TODAY, category: "gear", amount: 89.99 }).length === 0 && validateExpense({ date: TODAY, category: "cars" as never, amount: -1 }).length === 2);
  const r = seasonRange(TODAY);
  check("season Aug-Jul", r.from === "2026-08-01" && r.to === "2027-07-31" && seasonRange("2027-03-01").from === "2026-08-01");
  const b = budgetSummary([{ id: "a", date: "2026-09-01", category: "club_fees", amount: 1200 }, { id: "b", date: "2026-10-02", category: "gear", amount: 150.5 }, { id: "c", date: "2025-09-01", category: "gear", amount: 999 }], r.from, r.to, 3000);
  check("budget totals this season only", b.total === 1350.5 && b.left === 1649.5 && b.byCategory[0].category === "club_fees");
  const card = emergencyCard(prof("2014-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] }, health: { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [], asthma: { has: true } }, contact: { parentPhone: "973-555-0100", emergencyContact: { name: "Irina", phone: "973-555-0199" } } }));
  check("emergency card: allergy, EpiPen, asthma, contacts, steps", card.lines.some((l) => l.label === "EpiPen" && l.urgent) && card.lines.some((l) => l.label === "Asthma") && card.contacts.length === 2 && card.steps[0].includes("EpiPen"));
  check("aisles", aisleFor("Bananas") === "Produce" && aisleFor("Rice (white or jasmine)") === "Pantry" && aisleFor("Chicken breast") === "Meat and seafood");
  const g = buildGroceryList(prof("2011-01-01"), TODAY, 7);
  check("grocery aisles cover every item", g.aisles.reduce((a, x) => a + x.items.length, 0) === g.sections.reduce((a, x) => a + x.items.length, 0));
  const keeper = prof("2008-01-01", { sport: { primarySport: "soccer", positions: ["goalkeeper"], competitionLevel: "high_school" }, schedule: { events: [{ type: "match", startTime: `${TODAY}T10:00:00-04:00`, importance: "high" }] } });
  const mid = { ...keeper, sport: { ...keeper.sport, positions: ["midfielder"] } };
  check("keeper eats less carb than midfielder on game day", dailyTargets(keeper, TODAY).carbsPerKg[1] < dailyTargets(mid, TODAY).carbsPerKg[1]);
  check("position tips", positionFuel(keeper).tips.length >= 2);
  const n = nextUp(keeper, `${TODAY}T08:30`);
  check("countdown 90 min out: eat now", !!n && n.minutesAway === 90 && n.eatBy === "Eat now" && n.at === `${TODAY}T10:00:00-04:00`);
  const early = nextUp(keeper, `${TODAY}T05:00`);
  check("countdown morning: eat-by time", !!early?.eatBy && /Eat by/.test(early.eatBy));
  check("mental skills: kid version under 11", mentalSkills(prof("2018-01-01")).kid && !mentalSkills(prof("2011-01-01")).kid);
}

console.log("\nAsk the app: safety filter");
{
  const p = prof("2012-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe" }, { allergen: "milk", severity: "moderate" }], dietaryRestrictions: ["gluten_free"], intolerances: [], dislikes: ["broccoli"] } });
  check("allowed phrasing passes", unsafeMentions(p, "Try gluten-free pasta with soy milk, and avoid peanut butter.").length === 0);
  check("unsafe foods caught", unsafeMentions(p, "Have a peanut butter sandwich, cheese and broccoli.").length >= 3);
  const db = openDatabase(":memory:");
  const profiles = new SqliteAthleteProfileRepository(db), checkins = new SqliteCheckInRepository(db), records = new SqliteRecordRepository(db);
  const fam = new FamilyService(profiles, records);
  process.env.ANTHROPIC_API_KEY = "test";
  let calls = 0;
  const replies = ["Eat a peanut butter bagel.", "Still peanut butter.", "Rice, chicken and a banana, 3 hours before."];
  const fake = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: replies[calls++] }] }), { status: 200 })) as unknown as typeof fetch;
  const saved = await profiles.create("o9", input("2012-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } }));
  const ask = new AskService(profiles, checkins, fam, records, null, fake);
  const a1 = await ask.ask("o9", saved.id, "What should I eat before my game?", [], TODAY, `${TODAY}T07:00`);
  check("two unsafe answers -> safe fallback", a1.ok && !a1.value.checked && !/peanut/i.test(a1.value.answer));
  const a2 = await ask.ask("o9", saved.id, "And for lunch?", [], TODAY, `${TODAY}T07:00`);
  check("safe answer passes through", a2.ok && a2.value.checked && /Rice/.test(a2.value.answer));
  const crisis = await ask.ask("o9", saved.id, "I want to hurt myself", [], TODAY, `${TODAY}T07:00`);
  check("crisis -> 988 without calling the model", crisis.ok && /988/.test(crisis.value.answer) && calls === 3);
  const sys = await ask.systemPrompt(saved, "o9", TODAY, `${TODAY}T07:00`);
  check("system prompt carries food rules", /peanut/.test(sys) && /Never give weight-loss advice/.test(sys) && /talking to the player/.test(sys));

  console.log("\nPlayer service");
  const ps = new PlayerService(profiles, checkins, fam, records);
  const bad = await ps.addLog("o9", saved.id, { date: TODAY, type: "match", rating: 7 } as never);
  check("bad log rejected", !bad.ok);
  const good = await ps.addLog("o9", saved.id, { date: TODAY, type: "match", minutes: 60, goals: 1, rating: 4, wentWell: "Won headers" });
  check("log saved and in journal", good.ok && (await ps.journal("o9", saved.id, TODAY))!.logs.length === 1);
  check("stranger can't add logs", !(await ps.addLog("x", saved.id, { date: TODAY, type: "match" })).ok);
  await ps.addExpense("o9", saved.id, { date: TODAY, category: "gear", amount: 120 });
  await ps.setBudgetPlan("o9", saved.id, 2000);
  const bud = await ps.budget("o9", saved.id, TODAY);
  check("budget saved", bud!.total === 120 && bud!.left === 1880);
  const pr = await ps.progress("o9", saved.id, TODAY);
  check("reflection counts toward badges", pr!.badges.find((x) => x.id === "reflect5")!.progress === 1);
  const sr = await ps.seasonReview("o9", saved.id, TODAY);
  check("season review", sr!.stats.goals === 1 && sr!.highlights[0].text === "Won headers");
}

console.log("\nRecipes by age and kitchen");
{
  const kid = prof("2018-06-01"), junior = prof("2014-06-01"), teen = prof("2011-06-01");
  const k = recipeBook(kid, { who: "alone" });
  check("7-year-old alone: no-cook only", k.cook.id === "little" && k.recipes.length >= 5 && k.recipes.every((r) => r.level === 1));
  check("7-year-old alone: nothing with heat or knives in steps", k.recipes.every((r) => r.steps.every((s) => !s.uses || s.uses === "freezer")));
  const kt = recipeBook(kid, { who: "together" });
  const pasta = kt.recipes.find((r) => r.id === "pasta_night")!;
  check("cook together: grown-up does the stove steps, kid does the rest", pasta.mode === "together" && pasta.steps.filter((s) => s.uses === "stove").every((s) => s.who === "grown-up") && pasta.steps.some((s) => s.who === "you"));
  check("kid tips shown for young kids only", !!kt.recipes.find((r) => r.kidTip) && !recipeBook(teen).recipes.some((r) => r.kidTip));
  const j = recipeBook(junior, { who: "alone" });
  check("11-year-old alone: microwave, toaster, blender yes; stove and oven no", j.recipes.some((r) => r.equipment.includes("microwave")) && !j.recipes.some((r) => r.equipment.some((e) => e === "stove" || e === "oven" || e === "knife")));
  const t = recipeBook(teen, { who: "alone" });
  check("14-year-old alone: stovetop recipes included", t.cook.id === "home" && t.recipes.some((r) => r.equipment.includes("stove")) && t.recipes.every((r) => r.mode === "alone"));
  check("kitchen filter: microwave only", recipeBook(teen, { have: ["microwave"] }).recipes.every((r) => r.equipment.every((e) => e === "microwave")));
  check("time filter", recipeBook(teen, { maxMinutes: 10 }).recipes.every((r) => r.minutes <= 10));
  check("batch cooking filter", recipeBook(teen, { batch: true }).recipes.length >= 3 && recipeBook(teen, { batch: true }).recipes.every((r) => r.batch));
  check("unlock counts for the picker", (recipeBook(teen).unlocks.stove ?? 0) > 5);
  const nut = prof("2011-06-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } });
  check("recipes still follow allergies", !JSON.stringify(recipeBook(nut).recipes).toLowerCase().includes("peanut"));
  const vendors = [
    { id: "v1", brand: "BrandCo", product: "Protein Pasta", replaces: "pasta", allergens: ["wheat", "gluten"], gluten: true, active: true },
    { id: "v2", brand: "NutCo", product: "Crunchy Spread", replaces: "sunbutter", allergens: ["peanut"], active: true },
    { id: "v3", brand: "OldCo", product: "Rice", replaces: "rice", active: true, end: "2020-01-01" },
  ];
  const off = recipeBook(teen, {}, { vendors, today: TODAY });
  check("vendor placements off by default", !JSON.stringify(off).includes("BrandCo"));
  process.env.VENDOR_PLACEMENTS = "on";
  const on = recipeBook(teen, {}, { vendors, today: TODAY });
  check("switched on: sponsored product shown on the ingredient", on.recipes.some((r) => r.ingredients.some((i) => i.sponsored?.brand === "BrandCo")));
  check("sponsored product never shown if unsafe for the player", !JSON.stringify(recipeBook(nut, {}, { vendors, today: TODAY })).includes("NutCo"));
  check("expired placement not shown", !JSON.stringify(on).includes("OldCo"));
  const gf = prof("2011-06-01", { nutrition: { allergies: [], dietaryRestrictions: ["gluten_free"], intolerances: [], dislikes: [] } });
  check("wheat pasta brand never shown to a gluten-free player", !JSON.stringify(recipeBook(gf, {}, { vendors, today: TODAY })).includes("BrandCo"));
  delete process.env.VENDOR_PLACEMENTS;
}

console.log(`\nExtras tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
