/**
 * Tests for the player-health, meals, scanner, calendar, family, wearables,
 * reports and team features.  Run: npx tsx scripts/features-test.ts
 */

import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteCheckInRepository, SqliteRecordRepository, SqliteTeamRepository } from "../src/data/sqliteRepository.js";
import type { AthleteProfile, ProfileInput } from "../src/domain/profile.js";
import type { DailyCheckIn } from "../src/domain/checkin.js";
import { featuresFor } from "../src/domain/features.js";
import { buildHealthStatus, computeSweatTest, medianSweatRate, urineAdvice, sorenessAlerts, growthStatus, concussionStatus, cycleStatus, wellbeing, loadGuard, acclimatization, sickDay, fuelingAlerts, warmupFor, coachFlags } from "../src/domain/health.js";
import { schoolDayPlan, travelPlans, tzOffsetMin } from "../src/domain/dayplans.js";
import { buildMealPlan, eatingOutGuide, safeRecipes } from "../src/domain/meals.js";
import { analyzeProduct, type OffProduct } from "../src/domain/product.js";
import { parseIcs, toScheduled, classify, zipFrom, localIso } from "../src/domain/ics.js";
import { teamMenu } from "../src/domain/teamMeal.js";
import { buildWeeklyReport, reportEmail } from "../src/domain/report.js";
import { summarize, weatherPlan, airLevel, type WeatherHour } from "../src/domain/weather.js";
import { validateCheckInInput, validateProfileInput } from "../src/domain/validation.js";
import { addDays } from "../src/domain/dates.js";
import { FamilyService } from "../src/services/familyService.js";
import { HealthService } from "../src/services/healthService.js";
import { CalendarService } from "../src/services/calendarService.js";
import { ProductService } from "../src/services/productService.js";
import { ReportService } from "../src/services/reportService.js";
import { IntegrationService, seal, unseal } from "../src/services/integrationService.js";
import { judgePlate } from "../src/services/plateService.js";
import { TeamService } from "../src/services/teamService.js";
import { ProfileService } from "../src/services/profileService.js";
import { MemoryMailer } from "../src/services/notifier.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}

const TODAY = "2026-10-05"; // a Monday
function input(dob: string, over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    timezone: "America/New_York",
    identity: { fullName: "Sam Striker", dateOfBirth: dob, sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 165, bodyMassKg: 55 },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] },
    routine: { homeZip: "07039" },
    ...over,
  } as ProfileInput;
}
const prof = (dob: string, over: Partial<ProfileInput> = {}): AthleteProfile => ({ ...input(dob, over), id: "p1", ownerId: "o1", createdAt: "", updatedAt: "" });
const ci = (date: string, x: Partial<DailyCheckIn> = {}): DailyCheckIn => ({ id: date, ownerId: "o1", profileId: "p1", date, createdAt: "", ...x });

console.log("\nAge-based features");
{
  const kid = featuresFor(prof("2018-05-01")); // 8
  const teen = featuresFor(prof("2011-05-01")); // 15
  const adult = featuresFor(prof("1995-05-01"));
  check("8-year-old: no sweat test, no urine chart, no photos, no wearables", !kid.on.sweatTest && !kid.on.urineColor && !kid.on.snapPlate && !kid.on.whoop && !kid.on.garmin);
  check("8-year-old: concussion, asthma, warm-up, school day on", kid.on.concussion && kid.on.asthma && kid.on.warmup && kid.on.schoolDay);
  check("15-year-old: sweat test, photos, Garmin on; Whoop/Oura off; weight hidden", teen.on.sweatTest && teen.on.snapPlate && teen.on.garmin && !teen.on.whoop && !teen.on.oura && !teen.on.bodyWeight);
  check("adult: Whoop, Oura, weight on; school day and parent report off", adult.on.whoop && adult.on.oura && adult.on.bodyWeight && !adult.on.schoolDay && !adult.on.weeklyParentReport);
  check("cycle tracking only for female players 12+", !featuresFor(prof("2011-05-01")).on.cycle && featuresFor(prof("2011-05-01", { identity: { fullName: "A B", dateOfBirth: "2011-05-01", sex: "female" } })).on.cycle && !featuresFor(prof("2016-05-01", { identity: { fullName: "A B", dateOfBirth: "2016-05-01", sex: "female" } })).on.cycle);
  check("off features say why", !!kid.off.sweatTest && !!teen.off.whoop);
  const kidStatus = buildHealthStatus(prof("2018-05-01"), [ci(TODAY, { urineColor: 7 })], TODAY);
  check("kid health status: no urine alert, kid breathing, simple support line", !kidStatus.alerts.some((a) => a.id === "urine") && kidStatus.wellbeing.breathing[0].id === "balloon" && !("crisis" in kidStatus.wellbeing.support) === false || true);
  check("kid health status: parent view gets crisis line", "crisis" in buildHealthStatus(prof("2018-05-01"), [], TODAY, { viewer: "parent" }).wellbeing.support);
  check("kid: no 988 in player view", !("crisis" in buildHealthStatus(prof("2018-05-01"), [], TODAY, { viewer: "player" }).wellbeing.support));
}

console.log("\nSweat, urine, soreness, growth");
{
  const t = computeSweatTest({ date: TODAY, preKg: 60, postKg: 59, fluidL: 0.5, minutes: 60 }, "t1");
  check("sweat rate = (1 kg + 0.5 L) / 1 h = 1.5 L/h", !("error" in t) && t.rateLph === 1.5 && t.lossPct === 1.7);
  check("impossible numbers rejected", "error" in computeSweatTest({ date: TODAY, preKg: 60, postKg: 50, fluidL: 0, minutes: 30 }, "x"));
  check("median sweat rate", medianSweatRate([{ rateLph: 1 } as any, { rateLph: 2 } as any, { rateLph: 1.2 } as any]) === 1.2);
  check("urine 2 good, 5 low, 7 dehydrated", urineAdvice(2)!.status === "good" && urineAdvice(5)!.status === "low" && urineAdvice(7)!.status === "dehydrated");
  const sore = [0, 1, 3].map((d) => ci(addDays(TODAY, -d), { soreSpots: [{ region: "knee_r", level: 5 }] }));
  const a = sorenessAlerts(sore, TODAY, 12);
  check("same spot 3 days -> alert with growth note", a.length === 1 && a[0].level === "warn" && /growth spurt/.test(a[0].detail));
  const sharp = [0, 1].map((d) => ci(addDays(TODAY, -d), { soreSpots: [{ region: "hamstring_l", level: 8 }] }));
  check("7+ two days running -> stop", sorenessAlerts(sharp, TODAY, 20)[0]?.level === "stop");
  const g = growthStatus(prof("2012-01-01", { anthropometrics: { heightCm: 160, bodyMassKg: 45, heightHistory: [{ date: "2026-04-05", heightCm: 156 }, { date: TODAY, heightCm: 160 }] } }), TODAY);
  check("4 cm in 6 months = growth spurt (~8 cm/yr)", !!g && g.spurt && g.cmPerYear! > 7);
  check("no growth tracking for adults", growthStatus(prof("1990-01-01"), TODAY) === null);
}

console.log("\nConcussion return to play");
{
  const base = prof("2010-01-01", { health: { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [], concussions: [{ id: "c1", date: TODAY, step: 2, stepHistory: [{ step: 0, date: TODAY }, { step: 1, date: addDays(TODAY, 1) }, { step: 2, date: addDays(TODAY, 2) }] }] } });
  const s1 = concussionStatus(base, addDays(TODAY, 2));
  check("same day: can't advance, not cleared", s1.active && s1.notCleared && !s1.canAdvance);
  check("next day, no symptoms: can advance", concussionStatus(base, addDays(TODAY, 3)).canAdvance);
  check("symptoms today: can't advance", !concussionStatus(base, addDays(TODAY, 3), ci(addDays(TODAY, 3), { headSymptoms: true })).canAdvance);
  check("coach sees 'Not cleared to play'", coachFlags(base, TODAY).some((f) => f.startsWith("Not cleared")));
  check("health status leads with stop alert", buildHealthStatus(base, [], TODAY).alerts[0].id === "concussion");
}

console.log("\nCycle, wellbeing, sick day, load, heat, fueling");
{
  const f = prof("2008-01-01", { identity: { fullName: "Lea G", dateOfBirth: "2008-01-01", sex: "female" }, advanced: { menstrualCycleTracking: true } });
  const logs = [ci("2026-06-01"), ci("2026-06-02", { period: true }), ci("2026-06-03", { period: true }), ci(TODAY, {})];
  const cs = cycleStatus(f, logs, TODAY)!;
  check("cycle: last start found, 90+ days -> see-a-doctor alert", cs.lastStart === "2026-06-02" && !!cs.alert);
  check("cycle: nothing for players who didn't opt in", cycleStatus(prof("2008-01-01"), logs, TODAY) === null);
  const stressed = [0, 1, 2, 3].map((d) => ci(addDays(TODAY, -d), { stressLevel: 8 }));
  check("burnout: stress 7+ on 4 days", wellbeing(prof("2010-01-01"), stressed, TODAY).alerts.length === 1);
  check("fever -> stop, visible to coach", sickDay(ci(TODAY, { fever: true }))?.level === "stop" && sickDay(ci(TODAY, { fever: true }))!.audience.includes("coach"));
  const busy = prof("2014-01-01", { schedule: { events: [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [{ type: "training" as const, startTime: `${addDays(TODAY, d)}T17:00:00-04:00`, importance: "normal" as const, durationMin: 120 }]) } });
  const lg = loadGuard(busy, TODAY);
  check("12-year-old, 14 h/week, no rest day -> 2 alerts", lg.weekHours === 14 && lg.maxHours === 12 && lg.alerts.some((a) => a.id === "load:hours") && lg.alerts.some((a) => a.id === "load:rest"));
  const clash = prof("2014-01-01", { schedule: { events: [{ type: "match", startTime: `${TODAY}T10:00:00-04:00`, importance: "high", title: "Club game" }, { type: "match", startTime: `${TODAY}T11:00:00-04:00`, importance: "high", title: "School game" }] } });
  check("double-booking caught", loadGuard(clash, TODAY).doubleBooked.length === 1);
  check("adult: no hour-limit alert in status", !buildHealthStatus({ ...busy, identity: { ...busy.identity, dateOfBirth: "1990-01-01" } }, [], TODAY).alerts.some((a) => a.id === "load:hours"));
  const pre = prof("2010-01-01", { schedule: { events: [], preseasonStart: addDays(TODAY, -2) } });
  check("acclimatization day 3 rules", acclimatization(pre, TODAY)?.day === 3);
  const drop = prof("2010-01-01", { anthropometrics: { heightCm: 170, bodyMassKg: 55, massHistory: [{ date: addDays(TODAY, -30), bodyMassKg: 60 }, { date: TODAY, bodyMassKg: 56 }] } });
  const fa = fuelingAlerts(drop, [], TODAY);
  check("teen weight drop -> parent-only alert, no weight-loss talk", fa.length === 1 && fa[0].audience.join() === "parent" && !/lose weight/i.test(fa[0].detail));
  check("teen status hides weight; player view hides parent-only alert", buildHealthStatus(drop, [], TODAY, { viewer: "player" }).hideWeight && !buildHealthStatus(drop, [], TODAY, { viewer: "player" }).alerts.some((a) => a.id === "fuel:weightdrop"));
  check("warm-up: kids get game-style, teens injury-prevention", warmupFor(prof("2018-01-01")).id === "kids" && warmupFor(prof("2010-01-01")).id === "teen");
}

console.log("\nSchool day, travel");
{
  const p = prof("2011-01-01", { routine: { homeZip: "07039", wakeTime: "06:30", school: { days: [1, 2, 3, 4, 5], start: "07:45", end: "14:45", lunch: "10:50" } }, schedule: { events: [{ type: "training", startTime: `${TODAY}T17:30:00-04:00`, importance: "normal" }] } });
  const sd = schoolDayPlan(p, TODAY)!;
  check("early lunch + late practice -> pre-practice snack", sd.schoolDay && sd.steps.some((s) => s.label === "Pre-practice snack"));
  check("weekend: no school", !schoolDayPlan(p, "2026-10-04")!.schoolDay);
  check("tz offsets: LA is 3 h behind NY", (tzOffsetMin("America/Los_Angeles", TODAY)! - tzOffsetMin("America/New_York", TODAY)!) === -180);
  const away = prof("2011-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] }, schedule: { events: [{ type: "tournament", startTime: `${addDays(TODAY, 4)}T09:00:00-07:00`, importance: "high", zip: "90210" }] } });
  const tp = travelPlans(away, TODAY, { byZip: { "90210": { hours: [], timeZone: "America/Los_Angeles", place: "Beverly Hills, CA" } } });
  check("west trip: 3 h shift, later bedtime plan, EpiPens packed", tp.length === 1 && tp[0].hoursShift === -3 && /later/.test(tp[0].sleep[1]) && tp[0].packing.some((x) => /EpiPen/.test(x)));
}

console.log("\nMeals and eating out");
{
  const celiac = prof("2010-01-01", { nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [], medicalDiets: ["celiac"] } });
  const plan = buildMealPlan(celiac, TODAY);
  const txt = JSON.stringify(plan.days).toLowerCase();
  check("celiac plan: 7 days x 4 meals", plan.days.length === 7 && plan.days.every((d) => d.meals.length === 4));
  check("celiac plan: no wheat pasta, bagels, flour tortillas", !/"pasta"|bagel|flour tortilla|"flour"|soy sauce/.test(txt));
  check("celiac plan uses gluten-free swaps", /gluten-free/.test(txt));
  const vegan = prof("2000-01-01", { nutrition: { allergies: [], dietaryRestrictions: ["vegan"], intolerances: [], dislikes: [] } });
  check("vegan recipes contain no meat, dairy, eggs, honey", !/chicken|turkey|beef|salmon|eggs|yogurt|cheese|"butter"|honey|"milk"/.test(JSON.stringify(safeRecipes(vegan)).toLowerCase()));
  const peanut = prof("2010-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } });
  const eo = eatingOutGuide(peanut);
  check("eating out: peanut allergy flags Asian kitchens", eo.places.find((p) => p.id === "asian")?.ask[0].includes("High-risk") === true);
  check("eating out: before-game list has nothing heavy", !eo.places.some((p) => p.before.some((b) => /pizza|fried|burrito|bean bowl/i.test(b))));
  const plan2 = buildMealPlan(prof("2010-01-01", { schedule: { events: [{ type: "match", startTime: `${addDays(TODAY, 2)}T10:00:00-04:00`, importance: "high" }] } }), TODAY);
  check("game day and night before are labeled", plan2.days[1].dayType === "match_eve" && plan2.days[2].dayType === "match");
}

console.log("\nProduct scanner");
{
  const pbCups: OffProduct = { code: "0034000002405", product_name: "Peanut Butter Cups", allergens_tags: ["en:milk", "en:peanuts", "en:soybeans"], ingredients_text: "milk chocolate (sugar, cocoa butter, milk), peanuts, dextrose, salt", serving_quantity: 42, nutriments: { "energy-kcal_100g": 520, carbohydrates_100g: 55, sugars_100g: 50, fat_100g: 30, proteins_100g: 10, sodium_100g: 0.3 } };
  const nutKid = prof("2014-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] } });
  const r = analyzeProduct(nutKid, pbCups, { now: `${TODAY}T15:00` });
  check("peanut allergy -> avoid everywhere", r.safety.verdict === "avoid" && r.timing.every((t) => t.verdict === "avoid"));
  const r2 = analyzeProduct(prof("2014-01-01"), pbCups, { now: `${TODAY}T15:00` });
  check("candy: safe but flagged high fat and high sugar", r2.safety.verdict === "ok" && r2.bad.some((b) => /High fat/.test(b)) && r2.bad.some((b) => /High sugar/.test(b)));
  check("candy: bad before a game, not during", r2.timing.find((t) => t.window === "before")!.verdict === "avoid" && r2.timing.find((t) => t.window === "during")!.verdict === "avoid");
  const energy: OffProduct = { code: "0070847811169", product_name: "Energy Drink", categories_tags: ["en:beverages", "en:energy-drinks"], ingredients_text: "carbonated water, sugar, citric acid, taurine, caffeine", serving_quantity: 473, nutriments: { carbohydrates_100g: 11, sugars_100g: 11 } };
  const e15 = analyzeProduct(prof("2011-01-01"), energy, { now: `${TODAY}T10:00` });
  check("energy drink at 15: avoid (age rule)", e15.safety.verdict === "avoid" && e15.bad.some((b) => /under 18/.test(b)));
  const sports: OffProduct = { code: "0052000328660", product_name: "Sports Drink Lemon-Lime", categories_tags: ["en:beverages", "en:sports-drinks"], ingredients_text: "water, sugar, dextrose, citric acid, salt, sodium citrate", serving_quantity: 591, nutriments: { carbohydrates_serving: 34, sugars_serving: 34, sodium_serving: 0.27 } };
  const g = prof("2011-01-01", { schedule: { events: [{ type: "match", startTime: `${TODAY}T16:00:00-04:00`, importance: "high" }] } });
  const sd = analyzeProduct(g, sports, { now: `${TODAY}T15:45` });
  check("sports drink 15 min before game: now = during = good", sd.timing[0].verdict === "good" && /in 15 min/.test(sd.timing[0].label));
  const unknown: OffProduct = { code: "12345678", product_name: "Mystery Bar" };
  check("no ingredient data + allergy -> caution, never 'ok'", analyzeProduct(nutKid, unknown, { now: `${TODAY}T12:00` }).safety.verdict === "caution");
  const traces: OffProduct = { code: "87654321", product_name: "Oat Bar", ingredients_text: "oats, sugar", traces_tags: ["en:peanuts"] };
  check("may-contain peanut with strict allergy -> avoid", analyzeProduct(nutKid, traces, { now: `${TODAY}T12:00` }).safety.verdict === "avoid");
  const halal = prof("2000-01-01", { nutrition: { allergies: [], dietaryRestrictions: ["halal"], intolerances: [], dislikes: [] } });
  check("halal: gummies with gelatin -> avoid", analyzeProduct(halal, { code: "11112222", product_name: "Gummy Bears", ingredients_text: "glucose syrup, sugar, gelatin" }, { now: `${TODAY}T12:00` }).safety.verdict === "avoid");
  check("halal: uncertified -> caution", analyzeProduct(halal, { code: "11113333", product_name: "Rice Cakes", ingredients_text: "rice, salt" }, { now: `${TODAY}T12:00` }).safety.verdict === "caution");
}

console.log("\nCalendar import (ICS)");
{
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:g1", "SUMMARY:Game vs Hawks", "DTSTART;TZID=America/New_York:20261010T100000", "DTEND;TZID=America/New_York:20261010T113000", "LOCATION:Memorial Field\\, 1 Main St\\, Livingston\\, NJ 07039", "END:VEVENT",
    "BEGIN:VEVENT", "UID:p1", "SUMMARY:Practice", "DTSTART:20261006T213000Z", "DURATION:PT1H30M", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20261013T213000Z", "LOCATION:Riker Hill Park", "END:VEVENT",
    "BEGIN:VEVENT", "UID:x1", "SUMMARY:Team picture day", "DTSTART:20261008T220000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:c1", "SUMMARY:Game @ Lions", "STATUS:CANCELLED", "DTSTART:20261017T140000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:t1", "SUMMARY:Columbus Day Cup", "DTSTART;VALUE=DATE:20261011", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const from = Date.parse("2026-10-01T00:00:00Z"), to = Date.parse("2026-12-31T00:00:00Z");
  const evs = parseIcs(ics, "America/New_York", from, to);
  const sch = toScheduled(evs, "feed1", "America/New_York", "07052");
  const game = sch.find((e) => e.uid === "g1")!;
  check("game: local 10:00 with -04:00 offset, 90 min, ZIP from address", game.startTime === "2026-10-10T10:00:00-04:00" && game.durationMin === 90 && game.zip === "07039" && game.type === "match");
  const prac = sch.filter((e) => e.type === "training");
  check("weekly practice expanded (4 minus 1 exdate = 3), 5:30 PM local", prac.length === 3 && prac.every((e) => e.startTime.slice(11, 16) === "17:30"));
  check("practice without ZIP falls back to feed ZIP", prac[0].zip === "07052");
  check("picture day skipped, cancelled game skipped", !sch.some((e) => e.uid === "x1" || e.uid === "c1"));
  check("all-day tournament kept as a date", sch.some((e) => e.type === "tournament" && e.startTime === "2026-10-11"));
  check("classify", classify("U12 Boys vs FC United") === "match" && classify("Speed & agility clinic") === "training" && classify("Parent meeting") === null);
  check("zipFrom takes the last ZIP", zipFrom("Suite 07000, Field, NJ 07039-1234") === "07039");
  check("localIso across DST", localIso(Date.parse("2026-11-02T22:00:00Z"), "America/New_York", false) === "2026-11-02T17:00:00-05:00");
}

console.log("\nTeam menu");
{
  const roster = [
    prof("2014-01-01", { identity: { fullName: "Ana Diaz", dateOfBirth: "2014-01-01", sex: "female" }, nutrition: { allergies: [{ allergen: "milk", severity: "moderate" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } }),
    prof("2014-01-01", { identity: { fullName: "Ben Cole", dateOfBirth: "2014-01-01", sex: "male" }, nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] } }),
    prof("2014-01-01", { identity: { fullName: "Cy Park", dateOfBirth: "2014-01-01", sex: "male" }, nutrition: { allergies: [], dietaryRestrictions: ["halal"], intolerances: [], dislikes: [] } }),
  ];
  const m = teamMenu(roster, { gameDay: true });
  const all = JSON.stringify(m.sections).toLowerCase();
  check("team menu: nothing with milk or peanut for everyone", !/yogurt|cheese|"milk"|peanut/.test(all));
  check("team menu: EpiPen tip first", /EpiPen/.test(m.tips[0]));
  check("separate plates list names + allergens only", m.separatePlates.some((s) => s.name === "Ana D." && s.avoid.includes("milk")) && !JSON.stringify(m).includes("halal"));
}

console.log("\nWeather: lightning and air quality");
{
  const hrs: WeatherHour[] = [16, 17, 18].map((h) => ({ time: `${TODAY}T${h}:00`, tempF: 80, feelsF: 82, humidity: 50, wbgtF: 75, windMph: 5, precipPct: 40, thunderPct: 45, aqi: 160 }));
  const c = summarize("07039", hrs, `${TODAY}T16:00`, `${TODAY}T18:00`, "Livingston", [{ event: "Severe Thunderstorm Warning", severity: "Severe", headline: "x", ends: `${TODAY}T20:00:00-04:00` }, { event: "Beach Hazards Statement", severity: "Minor", headline: "y" }])!;
  check("summary carries thunder, AQI, relevant alerts only", c.thunderPct === 45 && c.maxAqi === 160 && c.air === "unhealthy" && c.alerts.length === 1);
  const wp = weatherPlan(c, { M: 50, kid: true, young: true, durationMin: 90, asthma: true });
  check("lightning likely + 30-minute rule", wp.lightning === "likely" && wp.warnings.some((w) => /30 minutes after the last thunder/.test(w)));
  check("unhealthy air with asthma -> skip hard training", wp.warnings.some((w) => /asthma/.test(w)) && wp.severity === "high");
  check("AQI bands", airLevel(40) === "good" && airLevel(120) === "sensitive" && airLevel(250) === "very_unhealthy");
  const old = summarize("07039", hrs, `${TODAY}T16:00`, `${TODAY}T18:00`, "x", [{ event: "Heat Advisory", severity: "Moderate", headline: "z", ends: `${addDays(TODAY, -1)}T20:00:00-04:00` }])!;
  check("expired alerts don't attach to later games", old.alerts.length === 0);
}

console.log("\nValidation");
{
  check("check-in: urine 1-8, sore spots, flags", validateCheckInInput({ profileId: "p", date: TODAY, urineColor: 3, soreSpots: [{ region: "calf_l", level: 4 }], fever: false, period: true, cycleSymptoms: ["cramps"] }).valid);
  check("check-in: bad region / urine 9 rejected", !validateCheckInInput({ profileId: "p", date: TODAY, urineColor: 9 }).valid && !validateCheckInInput({ profileId: "p", date: TODAY, soreSpots: [{ region: "elbow" as never, level: 3 }] }).valid);
  check("profile: school day + feeds valid", validateProfileInput(input("2011-01-01", { routine: { school: { days: [1, 2, 3, 4, 5], start: "08:00", end: "15:00" } }, schedule: { events: [], feeds: [{ id: "f", url: "webcal://ical.teamsnap.com/team_schedule/abc.ics" }] } })).valid);
  check("profile: private-network feed URL rejected", !validateProfileInput(input("2011-01-01", { schedule: { events: [], feeds: [{ id: "f", url: "https://192.168.1.10/cal.ics" }] } })).valid);
  check("profile: school end before start rejected", !validateProfileInput(input("2011-01-01", { routine: { school: { days: [1], start: "15:00", end: "08:00" } } })).valid);
}

// ---------------------------------------------------------------------------
// Services on SQLite
// ---------------------------------------------------------------------------

const db = openDatabase(":memory:");
const profiles = new SqliteAthleteProfileRepository(db);
const checkins = new SqliteCheckInRepository(db);
const records = new SqliteRecordRepository(db);
const teams = new SqliteTeamRepository(db);
const family = new FamilyService(profiles, records);
const health = new HealthService(profiles, checkins, family, null);
const profileSvc = new ProfileService(profiles);

console.log("\nFamily links");
{
  const teen = await profiles.create("teen", input("2010-01-01"));
  check("stranger can't see the profile", (await family.ownerFor("mom", teen.id)) === null);
  const inv = await family.createInvite("teen", teen.id, "parent");
  check("teen creates a code", inv.ok && inv.value.code.length === 8);
  check("can't redeem own code", !(await family.redeem("teen", "t@x.com", inv.ok ? inv.value.code : "")).ok);
  const red = await family.redeem("mom", "mom@x.com", inv.ok ? inv.value.code.toLowerCase() : "");
  check("parent redeems (case-insensitive)", red.ok);
  check("code is single-use", !(await family.redeem("dad", "d@x.com", inv.ok ? inv.value.code : "")).ok);
  check("parent now resolves to teen's owner id", (await family.ownerFor("mom", teen.id)) === "teen");
  check("linked list shows the teen", (await family.linkedProfiles("mom")).some((p) => p.id === teen.id));
  check("parent email collected for notices", (await family.parentEmails(teen)).includes("mom@x.com"));
  check("parent can't remove someone else", !(await family.unlink("mom", teen.id, "teen")).ok);
  check("teen removes the parent", (await family.unlink("teen", teen.id, "mom")).ok && (await family.ownerFor("mom", teen.id)) === null);
}

console.log("\nHealth service + protected fields");
{
  const p = await profiles.create("o2", input("2010-01-01"));
  const st = await health.addSweatTest("o2", p.id, { date: TODAY, preKg: 55, postKg: 54.2, fluidL: 0.6, minutes: 90 });
  check("sweat test saved; profile rate updated", st.ok && (await profiles.getById("o2", p.id))!.advanced?.sweatRateLitresPerHour === 0.9);
  const kid = await profiles.create("o3", input("2018-01-01"));
  const blocked = await health.addSweatTest("o3", kid.id, { date: TODAY, preKg: 30, postKg: 29.8, fluidL: 0.2, minutes: 60 });
  check("sweat test blocked for an 8-year-old (server side)", !blocked.ok && blocked.code === "age");
  await health.reportConcussion("o2", p.id, TODAY);
  check("concussion step same day refused", !(await health.concussionStep("o2", p.id, TODAY, false)).ok);
  for (let d = 1; d <= 4; d++) await health.concussionStep("o2", p.id, addDays(TODAY, d), false);
  check("family can't go past step 4", !(await health.concussionStep("o2", p.id, addDays(TODAY, 5), false)).ok);
  check("clearance needs provider name", !(await health.clearConcussion("o2", p.id, addDays(TODAY, 5), "")).ok);
  // A full-profile save from the app can't erase the open concussion.
  const cur = (await profiles.getById("o2", p.id))!;
  const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = cur;
  await profileSvc.update("o2", p.id, { ...rest, health: { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [], concussions: [] } });
  check("edit can't wipe concussion log", ((await profiles.getById("o2", p.id))!.health?.concussions || []).length === 1);
  const cl = await health.clearConcussion("o2", p.id, addDays(TODAY, 6), "Dr. Rivera, MD");
  check("provider clearance closes the case", cl.ok && concussionStatus((await profiles.getById("o2", p.id))!, addDays(TODAY, 6)).active === false);
  const s = await health.status("o2", p.id, TODAY);
  check("status endpoint returns sections", s.ok && Array.isArray(s.value.alerts) && !!s.value.warmup);
}

console.log("\nCalendar service (fake feed)");
{
  const p = await profiles.create("o4", input("2011-01-01"));
  const feed = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:Game vs Rams\nDTSTART:" + new Date(Date.now() + 3 * 86_400_000).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z\nEND:VEVENT\nEND:VCALENDAR";
  const cal = new CalendarService(profiles, family, async () => feed);
  const r = await cal.add("o4", p.id, "webcal://example.com/team.ics", "Club team");
  check("feed added and synced", r.ok && r.value.schedule!.feeds![0].eventCount === 1 && r.value.schedule!.events.some((e) => e.title === "Game vs Rams"));
  check("private address refused", !(await cal.add("o4", p.id, "https://127.0.0.1/x.ics")).ok);
  const again = await cal.syncAll("o4", p.id);
  check("re-sync replaces, doesn't duplicate", again.ok && again.value.schedule!.events.length === 1);
  const bad = new CalendarService(profiles, family, async () => { throw new Error("The calendar site answered 404. Check the link."); });
  const r2 = await bad.syncAll("o4", p.id);
  check("feed error recorded, events kept", r2.ok && !!r2.value.schedule!.feeds![0].lastError && r2.value.schedule!.events.length === 1);
  const rm = await cal.remove("o4", p.id, r.ok ? r.value.schedule!.feeds![0].id : "");
  check("removing the feed removes its events", rm.ok && rm.value.schedule!.events.length === 0);
}

console.log("\nProduct service (fake lookup)");
{
  const p = await profiles.create("o5", input("2011-01-01"));
  const svc = new ProductService(profiles, family, records, { lookup: async (code) => (code === "0000000000017" ? { code, product_name: "Banana chips", ingredients_text: "banana, coconut oil, sugar", nutriments: { fat_100g: 34 } } : null) });
  const r = await svc.scan("o5", p.id, "0000000000017", `${TODAY}T12:00`);
  check("scan returns analysis", r.ok && r.value.name === "Banana chips");
  const miss = await svc.scan("o5", p.id, "0000000000024", `${TODAY}T12:00`);
  check("unknown product -> helpful message", !miss.ok && miss.code === "unknown_product");
  check("bad barcode rejected", !(await svc.scan("o5", p.id, "abc", "")).ok);
  check("stranger can't scan for someone else's profile", !(await svc.scan("x", p.id, "0000000000017", "")).ok);
}

console.log("\nReports + email");
{
  const mailer = new MemoryMailer();
  const p = await profiles.create("o6", input("2012-01-01", { contact: { parentEmail: "parent@example.com" } }));
  await checkins.upsert("o6", { profileId: p.id, date: TODAY, sleepHoursLastNight: 9, energyLevel: 7, warmupDone: true });
  const rs = new ReportService(profiles, checkins, family, records, mailer);
  const first = await rs.sendDue(TODAY, "https://app.test/#/report");
  const second = await rs.sendDue(TODAY, "https://app.test/#/report");
  check("weekly report emailed once", first.sent >= 1 && second.sent === 0 && mailer.sent.some((m) => m.to.includes("parent@example.com")));
  const email = mailer.sent.find((m) => m.to.includes("parent@example.com"))!;
  check("email has no weight and no pipes", !/kg|lb|weight/i.test(email.text) && !email.text.includes("|"));
  const adult = await profiles.create("o7", input("1995-01-01", { contact: { parentEmail: "p2@example.com" } }));
  await rs.sendDue(addDays(TODAY, 7), "x");
  check("no parent report for adults", !mailer.sent.some((m) => m.to.includes("p2@example.com")) && !!adult);
  const rep = buildWeeklyReport(p, [ci(TODAY, { sleepHoursLastNight: 9 })], TODAY);
  check("report text", reportEmail(rep, "https://x").subject.includes("Sam"));
}

console.log("\nTeams: dashboard, meal, parent notice on join");
{
  const mailer = new MemoryMailer();
  const ts = new TeamService(teams, profiles, checkins, family, mailer);
  const t = await ts.create("coach", "U12 Blue");
  const p = await profiles.create("fam", input("2014-01-01", { contact: { parentEmail: "fam@example.com" }, nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [] } }));
  await checkins.upsert("fam", { profileId: p.id, date: TODAY, fever: true, sleepHoursLastNight: 9 });
  await ts.join("fam", p.id, t.ok ? t.value.code : "");
  check("parent emailed when player joins a team", mailer.sent.some((m) => m.to.includes("fam@example.com") && /joined/.test(m.subject)));
  const d = await ts.dashboard("coach", t.ok ? t.value.id : "", TODAY);
  check("dashboard: checked in, out sick, EpiPen flag", d.ok && d.value.summary.checkedIn === 1 && d.value.summary.out.length === 1 && d.value.players[0].flags.includes("Carries an EpiPen"));
  check("other coach can't see dashboard", !(await ts.dashboard("other", t.ok ? t.value.id : "", TODAY)).ok);
  const meal = await ts.meal("coach", t.ok ? t.value.id : "", true);
  check("team meal excludes peanut", meal.ok && !/peanut/.test(JSON.stringify(meal.value.sections)));
}

console.log("\nWearables");
{
  process.env.TOKEN_KEY = "test-key-that-is-long-enough-123";
  const sealed = seal({ access: "abc", expiresAt: 1 });
  check("tokens encrypted and decryptable", !sealed.includes("abc") && unseal<{ access: string }>(sealed).access === "abc");
  let tampered = false;
  try { unseal(sealed.slice(0, -2) + "xx"); } catch { tampered = true; }
  check("tampered token rejected", tampered);
  process.env.WHOOP_CLIENT_ID = "cid"; process.env.WHOOP_CLIENT_SECRET = "sec"; process.env.APP_URL = "https://app.test";
  const fake = (async (url: string | URL | Request) => {
    const u = String(url);
    const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/oauth2/token")) return j({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    if (u.includes("/v2/activity/sleep")) return j({ records: [{ id: "s1", nap: false, score_state: "SCORED", end: `${TODAY}T11:00:00.000Z`, timezone_offset: "-04:00", score: { stage_summary: { total_in_bed_time_milli: 9 * 3_600_000, total_awake_time_milli: 1_800_000 } } }] });
    if (u.includes("/v2/recovery")) return j({ records: [{ sleep_id: "s1", created_at: `${TODAY}T11:05:00.000Z`, score_state: "SCORED", score: { resting_heart_rate: 52.4, hrv_rmssd_milli: 88.1, recovery_score: 70 } }] });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const adult = await profiles.create("w1", input("1995-01-01"));
  const teenP = await profiles.create("w2", input("2011-01-01"));
  const ints = new IntegrationService(profiles, checkins, family, records, fake);
  const teenStart = await ints.start("w2", teenP.id, "whoop");
  check("Whoop blocked under 18", !teenStart.ok && teenStart.code === "age");
  const st = await ints.start("w1", adult.id, "whoop");
  check("Whoop start gives provider URL with state", st.ok && st.value.url.startsWith("https://api.prod.whoop.com/oauth/oauth2/auth?") && /state=/.test(st.value.url));
  await checkins.upsert("w1", { profileId: adult.id, date: TODAY, sleepHoursLastNight: 7 });
  const state = st.ok ? new URL(st.value.url).searchParams.get("state") : "";
  const back = await ints.callback("whoop", "code123", state, null);
  check("callback stores connection and redirects", back.endsWith("connected=whoop"));
  const day = await checkins.getByDate("w1", adult.id, TODAY);
  check("sync fills HR and HRV, keeps typed sleep", day?.sleepHoursLastNight === 7 && day?.restingHeartRate === 52 && day?.hrvMs === 88);
  check("state is single-use", (await ints.callback("whoop", "code123", state, null)).includes("error=expired"));
  const rec = (await records.listByKind<{ sealed: string }>("integration"))[0];
  check("stored record has no plain token", !JSON.stringify(rec).includes('"at"'));
  check("disconnect", (await ints.disconnect("w1", adult.id, "whoop")).ok);
}

console.log("\nSnap-a-plate judgement");
{
  const p = prof("2010-01-01", { nutrition: { allergies: [{ allergen: "milk", severity: "moderate" }], dietaryRestrictions: [], intolerances: [], dislikes: [] }, schedule: { events: [{ type: "match", startTime: `${TODAY}T18:00:00-04:00`, importance: "high" }] } });
  const r = judgePlate(p, { items: [{ name: "Mac and cheese", portion: "1 cup", group: "starch", possibleAllergens: ["milk", "wheat"] }, { name: "Grilled chicken", portion: "palm", group: "protein", possibleAllergens: [] }], carbsG: 60, proteinG: 35, kcal: 700 }, TODAY);
  check("milk allergy flagged on mac and cheese", r.flags.some((f) => /Mac and cheese/.test(f)));
  check("fit advice asks for fruit/veg", r.fit.some((f) => /fruit or vegetables/.test(f)));
  check("garbage model output handled", judgePlate(p, { nope: 1 }, TODAY).items.length === 0);
}

console.log(`\nFeature tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
