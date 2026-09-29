/**
 * Lightweight end-to-end test harness (no framework needed).
 */

import { openDatabase } from "../src/data/db.js";
import {
  SqliteAthleteProfileRepository,
  SqliteCheckInRepository,
} from "../src/data/sqliteRepository.js";
import { ProfileService } from "../src/services/profileService.js";
import { CheckInService } from "../src/services/checkinService.js";
import type { ProfileInput } from "../src/domain/profile.js";
import type { CheckInInput } from "../src/domain/checkin.js";
import { buildMatchDayPlan } from "../src/domain/plan.js";
import { buildGameDayTimeline } from "../src/domain/timeline.js";
import type { AthleteProfile } from "../src/domain/profile.js";
import { SqliteTeamRepository } from "../src/data/sqliteRepository.js";
import { TeamService } from "../src/services/teamService.js";
import { AccountService } from "../src/services/accountService.js";
import { computeReadiness } from "../src/domain/readiness.js";
import { buildToday, classifyDay, dailyTargets } from "../src/domain/daily.js";
import { buildRecoveryPlan } from "../src/domain/recovery.js";
import { buildTrends } from "../src/domain/trends.js";
import { buildGroceryList } from "../src/domain/grocery.js";
import { buildReminders } from "../src/domain/reminders.js";
import { addDays } from "../src/domain/dates.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
}

function validProfile(): ProfileInput {
  return {
    timezone: "Europe/London",
    identity: {
      fullName: "Alex Athlete",
      dateOfBirth: "2003-04-12",
      sex: "male",
      hometown: "Leeds",
      graduationYear: 2025,
      school: "City Academy",
      clubTeam: "City U23",
      jerseyNumber: 8,
    },
    contact: {
      athleteEmail: "alex@example.com",
      parentEmail: "parent@example.com",
      emergencyContact: { name: "Jordan", relationship: "parent", phone: "+44 1234 567890" },
    },
    sport: {
      primarySport: "soccer",
      secondarySports: ["track"],
      positions: ["midfielder"],
      competitionLevel: "college",
      yearsPlaying: 12,
      dominantFoot: "right",
      seasonStatus: "in_season",
    },
    anthropometrics: { heightCm: 178, bodyMassKg: 75, bodyFatPct: 11 },
    training: {
      trainingDaysPerWeek: 5,
      avgSessionMinutes: 90,
      intensity: "high",
      matchesPerWeek: 2,
      strengthSessionsPerWeek: 2,
    },
    nutrition: {
      allergies: [{ allergen: "peanut", severity: "severe" }],
      dietaryRestrictions: [],
      intolerances: ["lactose"],
      preferredDiet: "none",
      dislikes: ["liver"],
      mealsPerDay: 4,
      mealPattern: "three_meals_plus_snacks",
      waterIntakeLitres: 3,
      caffeineMgPerDay: 120,
      supplements: ["creatine"],
    },
    recovery: {
      avgSleepHours: 8,
      sleepQuality: 7,
      napFrequency: "sometimes",
      recoveryMethods: ["stretching", "foam_rolling"],
      baselineSoreness: 3,
      baselineEnergy: 7,
    },
    health: {
      injuryHistory: [{ description: "left ankle sprain", date: "2024-09-01" }],
      currentInjuries: [],
      medicalConditions: [],
      medications: [],
      recentIllnessStatus: "healthy",
      fitnessNotes: "Strong aerobic base.",
    },
    goals: { goals: ["improve_endurance", "improve_recovery"], seasonGoals: "Start every match" },
    advanced: { restingHeartRate: 52, wearables: ["whoop"] },
    schedule: {
      events: [
        { type: "match", startTime: "2026-06-02T19:00:00+01:00", conditions: "warm", importance: "high" },
      ],
      travelDays: ["2026-06-05"],
      tournamentWeekends: [],
    },
  };
}

async function main(): Promise<void> {
  const db = openDatabase(":memory:");
  const profileRepo = new SqliteAthleteProfileRepository(db);
  const checkinRepo = new SqliteCheckInRepository(db);
  const profiles = new ProfileService(profileRepo);
  const checkins = new CheckInService(checkinRepo, profileRepo);
  const owner = "owner-A";
  const otherOwner = "owner-B";

  console.log("Profile: create + validation");
  const created = await profiles.create(owner, validProfile());
  check("valid profile is created", created.ok);
  const id = created.ok ? created.value.id : "";
  check("created profile has an id", created.ok && !!created.value.id);
  check("created profile is owner-scoped", created.ok && created.value.ownerId === owner);
  check("allergy stored as structured data", created.ok && created.value.nutrition.allergies[0]?.allergen === "peanut");
  check("grouped sections preserved", created.ok && created.value.training?.intensity === "high" && created.value.recovery?.sleepQuality === 7);

  console.log("\nProfile: validation failures");
  const badAllergy = validProfile();
  // @ts-expect-error intentionally invalid allergen
  badAllergy.nutrition.allergies = [{ allergen: "kryptonite", severity: "mild" }];
  check("unknown allergen rejected", !(await profiles.create(owner, badAllergy)).ok);

  const otherNoNote = validProfile();
  otherNoNote.nutrition.allergies = [{ allergen: "other", severity: "moderate" }];
  check('allergen "other" requires a note', !(await profiles.create(owner, otherNoNote)).ok);

  const badMass = validProfile();
  badMass.anthropometrics.bodyMassKg = 750;
  check("implausible body mass rejected", !(await profiles.create(owner, badMass)).ok);

  const contradictory = validProfile();
  contradictory.nutrition.dietaryRestrictions = ["vegan", "pescatarian"];
  check("contradictory diets rejected", !(await profiles.create(owner, contradictory)).ok);

  const noPosition = validProfile();
  noPosition.sport.positions = [];
  check("soccer profile requires a position", !(await profiles.create(owner, noPosition)).ok);

  const noAge = validProfile();
  delete noAge.identity.dateOfBirth;
  check("age must be determinable (DOB or age)", !(await profiles.create(owner, noAge)).ok);

  const ageOnly = validProfile();
  delete ageOnly.identity.dateOfBirth;
  ageOnly.identity.age = 21;
  check("explicit age accepted when DOB absent", (await profiles.create(owner, ageOnly)).ok);

  const extAvatar = validProfile();
  extAvatar.identity.avatarUrl = "https://evil.example/pixel.png";
  check("external avatar URLs rejected", !(await profiles.create(owner, extAvatar)).ok);
  const okAvatar = validProfile();
  okAvatar.identity.avatarUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  check("uploaded photo (data URL) accepted", (await profiles.create(owner, okAvatar)).ok);

  const badScale = validProfile();
  badScale.recovery!.sleepQuality = 99;
  check("out-of-range 1-10 scale rejected", !(await profiles.create(owner, badScale)).ok);

  console.log("\nProfile: owner-only access");
  check("another owner cannot read", !(await profiles.get(otherOwner, id)).ok);
  check("the owner can read", (await profiles.get(owner, id)).ok);
  check("another owner's list is empty", (await profiles.list(otherOwner)).length === 0);

  console.log("\nProfile: update + delete");
  const edited = validProfile();
  edited.anthropometrics.bodyMassKg = 76.5;
  const upd = await profiles.update(owner, id, edited);
  check("update succeeds for owner", upd.ok && upd.value.anthropometrics.bodyMassKg === 76.5);
  check("update preserves id", upd.ok && upd.value.id === id);
  check("another owner cannot update", !(await profiles.update(otherOwner, id, edited)).ok);

  console.log("\nDaily check-ins");
  const checkin: CheckInInput = {
    profileId: id,
    date: "2026-06-02",
    sleepHoursLastNight: 7.5,
    energyLevel: 8,
    stressLevel: 3,
    hydrationLevel: 7,
    sorenessLevel: 4,
    mood: "good",
    trainingPlanned: "match",
    trainingCompleted: false,
  };
  const logged = await checkins.log(owner, checkin);
  check("check-in logs for owner", logged.ok);
  check("check-in is owner-scoped", logged.ok && logged.value.ownerId === owner);

  check("invalid check-in date rejected", !(await checkins.log(owner, { profileId: id, date: "not-a-date", energyLevel: 8 })).ok);
  check("out-of-range check-in scale rejected", !(await checkins.log(owner, { profileId: id, date: "2026-06-03", energyLevel: 50 })).ok);
  check("check-in for unknown profile is 404", !(await checkins.log(owner, { profileId: "does-not-exist", date: "2026-06-02" })).ok);
  check("another owner cannot check-in to this profile", !(await checkins.log(otherOwner, { profileId: id, date: "2026-06-02" })).ok);

  await checkins.log(owner, { ...checkin, energyLevel: 5 });
  const list = await checkins.list(owner, id);
  check("one check-in per day (upsert)", list.length === 1);
  check("check-in upsert updates value", list[0]?.energyLevel === 5);

  console.log("\nMatch-day engine");
  const fullProfile = await profiles.create(owner, validProfile());
  const fp = fullProfile.ok ? (fullProfile.value as AthleteProfile) : null;
  if (fp) {
    const plan = buildMatchDayPlan(fp, { date: "2026-06-02", kickoff: "19:00", assumedKickoff: false });
    check("plan scales carbs to body mass (75kg -> 90g post)", plan.blocks.some((b) => b.targets.some((t) => t.detail.includes("90 g"))));
    check("plan lists 5 phases", plan.blocks.length === 5);
    check("peanut allergy surfaced in safety", plan.safety.avoidAllergens.includes("peanut"));
    const allFoods = plan.blocks.flatMap((b) => b.foods || []);
    check("lactose intolerant excludes Greek yogurt", !allFoods.includes("Greek yogurt"));
    const vegan = validProfile();
    vegan.nutrition.dietaryRestrictions = ["vegan"];
    const veganProfile = { ...fp, nutrition: vegan.nutrition } as AthleteProfile;
    const vplan = buildMatchDayPlan(veganProfile, { date: "2026-06-02", kickoff: "19:00", assumedKickoff: false });
    const vFoods = vplan.blocks.flatMap((b) => b.foods || []);
    check("vegan plan excludes chicken/eggs", !vFoods.includes("chicken breast") && !vFoods.includes("eggs"));
    check("vegan plan still offers a protein (tofu/lentils)", vFoods.includes("tofu") || vFoods.includes("lentils"));
  } else {
    check("plan profile created", false);
  }

  console.log("\nGame-day timeline");
  if (fp) {
    const tl = buildGameDayTimeline(fp, { date: "2026-06-02", kickoff: "19:00", wakeTime: "07:00", bedTime: "22:30", playsTomorrow: true });
    check("timeline starts at wake-up", tl.entries[0].time === "07:00" && tl.entries[0].phase === "Wake-up");
    check("kickoff entry present at 19:00", tl.entries.some((e) => e.time === "19:00" && e.phase === "Kickoff"));
    check("pre-game meal is 3.5h before (15:30)", tl.entries.some((e) => e.time === "15:30" && e.phase === "Pre-game meal"));
    check("immediate recovery scaled (75kg -> 90g)", tl.entries.some((e) => e.phase === "Immediate recovery" && e.detail.includes("90 g")));
    check("ends at bedtime", tl.entries[tl.entries.length - 1].time === "22:30");
    check("night routine flags game tomorrow", tl.nextDay.playsTomorrow === true && /tomorrow/i.test(tl.nightRoutine.title));
    check("calendar events generated", tl.calendar.length >= 1 && tl.calendar[0].start === "2026-06-02T19:00");
    // Day-before section is separated, dated the day before, with evening + night prep items.
    check("day-before section is dated the prior day", tl.dayBefore.date === "2026-06-01");
    check("day-before has evening + night prep items", tl.dayBefore.items.length >= 4 && tl.dayBefore.items.some((i) => /sleep/i.test(i.when) || /8.9 hours/i.test(i.detail)));
    check("day-before carb dinner has foods", tl.dayBefore.items[0].foods!.length > 0);
    check("night-before dinner added to calendar", tl.calendar.some((c) => c.start === "2026-06-01T18:30"));
    // Every game-day entry sits on a 15-minute increment.
    check("all timeline times are on 15-min increments", tl.entries.every((e) => Number(e.time.slice(3)) % 15 === 0));
    const noTomorrow = buildGameDayTimeline(fp, { date: "2026-06-02", kickoff: "19:00", playsTomorrow: false });
    check("no-game-tomorrow night routine differs", noTomorrow.nextDay.playsTomorrow === false);
  } else {
    check("timeline profile available", false);
  }

  console.log("\nReadiness");
  {
    const base = { id: "c", ownerId: owner, profileId: id, createdAt: "", date: "2026-06-02" };
    const good = computeReadiness({ ...base, sleepHoursLastNight: 9, energyLevel: 9, sorenessLevel: 2, stressLevel: 2, hydrationLevel: 8 });
    const bad = computeReadiness({ ...base, sleepHoursLastNight: 5, energyLevel: 3, sorenessLevel: 9, stressLevel: 8, hydrationLevel: 3 });
    check("well-rested check-in scores ready", !!good && good.status === "ready" && good.score >= 75);
    check("rough check-in scores low with limiters", !!bad && bad.status === "low" && bad.limiters.includes("sleep"));
    check("partial check-in still scores", computeReadiness({ ...base, energyLevel: 7 })?.score !== undefined);
    check("no check-in -> null", computeReadiness(null) === null);
  }

  // A schedule to drive the day engines: games on Sat 10:00 + Sun 09:00 (tournament),
  // practices Tue/Thu, and a lone game two weeks later.
  const sched = validProfile();
  sched.schedule = {
    events: [
      { type: "training", startTime: "2026-10-06T17:00", importance: "normal" },
      { type: "training", startTime: "2026-10-08T17:00", importance: "normal" },
      { type: "training", startTime: "2026-10-13T17:00", importance: "normal" },
      { type: "match", startTime: "2026-10-10T10:00", importance: "high" },
      { type: "match", startTime: "2026-10-10T15:00", importance: "high" },
      { type: "match", startTime: "2026-10-11T09:00", importance: "high" },
      { type: "match", startTime: "2026-10-24T19:00", importance: "high" },
    ],
  };
  sched.routine = { wakeTime: "07:00", bedTime: "22:00" };
  const sp = await profiles.create(owner, sched);
  const S = sp.ok ? sp.value : (null as unknown as AthleteProfile);
  check("profile with routine validates", sp.ok);
  const badRoutine = validProfile();
  badRoutine.routine = { wakeTime: "7am" };
  check("bad routine time rejected", !(await profiles.create(owner, badRoutine)).ok);

  console.log("\nDay types + targets");
  check("practice day classified", classifyDay(S, "2026-10-06") === "training");
  check("day before game classified", classifyDay(S, "2026-10-09") === "match_eve");
  check("game day classified", classifyDay(S, "2026-10-10") === "match");
  check("day after last game is recovery", classifyDay(S, "2026-10-12") === "recovery");
  check("empty day is rest", classifyDay(S, "2026-10-15") === "rest");
  const rest = dailyTargets(S, "2026-10-15");
  const game = dailyTargets(S, "2026-10-10");
  check("rest-day carbs 3-5 g/kg (75kg -> 225-375)", rest.carbsG[0] === 225 && rest.carbsG[1] === 375);
  check("game-day carbs higher than rest", game.carbsG[0] > rest.carbsG[0]);
  check("game-day fluids higher than rest", game.fluidsL > rest.fluidsL);
  const today = buildToday(S, "2026-10-10", null);
  check("Today flags tournament stretch", today.tournament && /Tournament/.test(today.focus[0]));
  check("Today lists both games", today.todaysEvents.filter((e) => e.type === "match").length === 2);
  check("Today next match is today", today.nextMatch?.daysAway === 0);

  console.log("\nEarly kickoffs");
  {
    const { gameMorning } = await import("../src/domain/dates.js");
    const normal = gameMorning("19:00", "07:00");
    check("evening game: meal 3.5h before, wake unchanged", normal.preMeal === "15:30" && normal.wake === "07:00" && !normal.lighter);
    const early = gameMorning("10:00", "07:00");
    check("10am game: meal after waking, lighter", early.preMeal === "07:30" && early.wake === "07:00" && early.lighter);
    const nine = gameMorning("09:00", "07:00");
    check("9am game: small meal 90 min out, normal alarm", nine.preMeal === "07:30" && nine.wake === "07:00" && nine.gapMin === 90);
    const dawn = gameMorning("08:00", "07:00");
    check("8am game: alarm 2h before (6:00), meal 90 min out", dawn.earlyAlarm && dawn.wake === "06:00" && dawn.preMeal === "06:30");
    const tl = buildGameDayTimeline(S, { date: "2026-10-10", kickoff: "10:00", wakeTime: "07:00" });
    const wakeE = tl.entries.find((e) => e.phase === "Wake-up")!, mealE = tl.entries.find((e) => e.phase === "Pre-game meal")!;
    check("timeline never puts the meal before wake-up", mealE.time > wakeE.time);
  }

  console.log("\nRecovery planner");
  const rec = buildRecoveryPlan(S, { today: "2026-10-11" });
  check("recovery links the 3 weekend games", rec.tournament && rec.matches.length === 3);
  check("same-day doubleheader gets a fast refuel window", rec.windows[0]?.kind === "fast");
  check("overnight gap gets a next-day window", rec.windows[1]?.kind === "same_or_next_day");
  check("plan runs through 2 days after the last game", rec.days[rec.days.length - 1].date === "2026-10-13");
  check("fast window scales carbs to mass (75kg -> ~85 g/h)", /8[05] g carbs per hour/.test(rec.windows[0].steps[0]));
  const none = buildRecoveryPlan(S, { today: "2026-10-20" });
  check("no recent game -> friendly empty state", none.anchor === null && !!none.message);
  const single = buildRecoveryPlan(S, { today: "2026-10-25" });
  check("single game -> not a tournament", !single.tournament && single.days.length === 3);

  console.log("\nTrends");
  {
    const cis = [] as import("../src/domain/checkin.js").DailyCheckIn[];
    for (let i = 0; i < 28; i++) {
      const date = addDays("2026-10-01", i);
      const heavy = i >= 21; // last week doubles the load
      cis.push({ id: "t" + i, ownerId: owner, profileId: id, createdAt: "", date,
        sleepHoursLastNight: 8, energyLevel: 7, sorenessLevel: heavy ? 7 : 3,
        sessionMinutes: 60, sessionRpe: heavy ? 9 : 4 });
    }
    const tr = buildTrends(id, cis, "2026-10-28");
    check("trend series covers 28 days", tr.days.length === 28);
    check("load spike detected", tr.load.status === "spike" && (tr.load.ratio ?? 0) > 1.5);
    check("check-in streak counted", tr.checkinStreak === 28);
    check("7-day soreness average reflects heavy week", tr.averages7.soreness === 7);
    const thin = buildTrends(id, cis.slice(-5), "2026-10-28");
    check("short history -> not enough data", thin.load.status === "not_enough_data");
  }

  console.log("\nGrocery list");
  const g = buildGroceryList(S, "2026-10-05", 7);
  const allItems = g.sections.flatMap((s) => s.items.map((i) => i.name));
  check("grocery counts 2 game days (Sat doubleheader + Sun)", g.dayCounts.match === 2 && g.dayCounts.training === 2);
  check("peanut allergy removes peanut butter", !allItems.some((n) => /peanut/i.test(n)));
  check("game-day section has sports drinks", allItems.some((n) => /Sports drink/.test(n)));
  const veganP = { ...S, nutrition: { ...S.nutrition, dietaryRestrictions: ["vegan"] as never[], intolerances: [] } } as AthleteProfile;
  const vg = buildGroceryList(veganP, "2026-10-05").sections.flatMap((s) => s.items.map((i) => i.name));
  check("vegan list has no chicken, eggs or yogurt", !vg.some((n) => /Chicken|Eggs|yogurt/.test(n)));
  check("vegan list still has plant protein", vg.some((n) => /Tofu|Lentils/.test(n)));
  const gfP = { ...S, nutrition: { ...S.nutrition, dietaryRestrictions: ["gluten_free"] as never[] } } as AthleteProfile;
  const gf = buildGroceryList(gfP, "2026-10-05").sections.flatMap((s) => s.items.map((i) => i.name));
  check("gluten-free swaps in GF pasta, drops bread", gf.includes("Gluten-free pasta") && !gf.includes("Bread or bagels"));
  const dfP = { ...S, nutrition: { ...S.nutrition, dietaryRestrictions: ["dairy_free"] as never[] } } as AthleteProfile;
  const dfPlan = buildMatchDayPlan(dfP, { date: "2026-10-10", kickoff: "10:00", assumedKickoff: false });
  check("dairy-free plan excludes whey shake", !dfPlan.blocks.flatMap((b) => b.foods || []).includes("whey shake"));

  console.log("\nReminders");
  const rem = buildReminders(S, { from: "2026-10-10", days: 1 });
  check("10:00 kickoff, 07:00 wake: meal moves to 07:30 (lighter), not before waking", rem.some((r) => r.at === "2026-10-10T07:30" && r.title === "Pre-game meal now" && /Lighter/.test(r.body)));
  check("second game same day gets its own meal 3h before (12:00)", rem.some((r) => r.at === "2026-10-10T12:00" && r.title === "Pre-game meal now"));
  check("reminder text uses 12-hour times", rem.every((r) => !/\b(1[3-9]|2[0-3]):\d\d\b/.test(r.body)));
  check("recovery snack after each game", rem.filter((r) => r.title === "Recovery snack now").length === 2);
  check("reminder ids are unique", new Set(rem.map((r) => r.id)).size === rem.length);
  check("reminders sorted by time", rem.every((r, i) => i === 0 || rem[i - 1].at <= r.at));
  const eve = buildReminders(S, { from: "2026-10-09", days: 1 });
  check("night before a game: carb dinner + wind-down", eve.some((r) => /carb dinner/.test(r.title)) && eve.some((r) => /Big day tomorrow/.test(r.title)));
  const later = buildReminders(S, { from: "2026-10-10", days: 1, now: "2026-10-10T12:00" });
  check("past reminders filtered by now", later.every((r) => r.at > "2026-10-10T12:00"));
  const noHydrate = buildReminders(S, { from: "2026-10-06", days: 1, prefs: { hydrate: false } });
  check("reminder kinds can be switched off", !noHydrate.some((r) => r.kind === "hydrate") && noHydrate.some((r) => r.title === "Pre-practice snack"));

  console.log("\nEvent removal");
  const rm1 = await profiles.removeEvents(owner, S.id, { startTime: "2026-10-24T19:00", type: "match" });
  check("single event removed", rm1.ok && !rm1.value.schedule!.events.some((e) => e.startTime === "2026-10-24T19:00"));
  const rmSeries = await profiles.removeEvents(owner, S.id, { startTime: "2026-10-06T17:00", type: "training", series: true });
  check("repeating Tuesday practices removed from that date on", rmSeries.ok && rmSeries.value.schedule!.events.filter((e) => e.type === "training").length === 1);
  check("other owner cannot remove events", !(await profiles.removeEvents(otherOwner, S.id, { startTime: "2026-10-10T10:00" })).ok);

  console.log("\nTeams (coach roster)");
  const teamRepo = new SqliteTeamRepository(db);
  const teams = new TeamService(teamRepo, profileRepo, checkinRepo);
  const coach = "coach-C";
  const t = await teams.create(coach, "U17 Boys");
  check("coach creates team with 6-char code", t.ok && /^[A-Z2-9]{6}$/.test(t.value.code));
  check("empty team name rejected", !(await teams.create(coach, "  ")).ok);
  const teamId = t.ok ? t.value.id : "";
  const code = t.ok ? t.value.code : "";
  check("wrong code rejected", !(await teams.join(owner, S.id, "NOPE00")).ok);
  check("cannot join someone else's profile", !(await teams.join(otherOwner, S.id, code)).ok);
  const j = await teams.join(owner, S.id, code.toLowerCase());
  check("player joins with code (case-insensitive)", j.ok);
  await teams.join(owner, S.id, code);
  await checkins.log(owner, { profileId: S.id, date: "2026-10-09", sleepHoursLastNight: 8, energyLevel: 8, sorenessLevel: 3 });
  const roster = await teams.roster(coach, teamId, "2026-10-09");
  check("rejoin does not duplicate", roster.ok && roster.value.players.length === 1);
  const pl = roster.ok ? roster.value.players[0] : null;
  check("roster shows readiness + next game", !!pl && !!pl.readiness && pl.nextMatch?.date === "2026-10-10");
  check("roster shows allergies for team meals", !!pl && pl.allergies.includes("peanut"));
  check("roster hides contact details", !!pl && !("contact" in pl) && !JSON.stringify(pl).includes("parent@example.com"));
  check("another coach is forbidden", (await teams.roster("coach-X", teamId, "2026-10-09")).ok === false);
  const mine = await teams.teamsForProfile(owner, S.id);
  check("player sees their teams", mine.ok && mine.value[0]?.name === "U17 Boys");
  check("player leaves team", (await teams.leave(owner, S.id, teamId)).ok);
  const after = await teams.roster(coach, teamId, "2026-10-09");
  check("roster empty after leaving", after.ok && after.value.players.length === 0);

  console.log("\nAccount deletion");
  await teams.join(owner, S.id, code);
  const account = new AccountService(profileRepo, checkinRepo, teamRepo);
  const beforeCount = (await profiles.list(owner)).length;
  const report = await account.deleteAllData(owner);
  check("deletes every profile the account owns", report.profiles === beforeCount && (await profiles.list(owner)).length === 0);
  check("deletes check-ins too", report.checkins >= 2 && (await checkins.list(owner, S.id)).length === 0);
  const r2 = await teams.roster(coach, teamId, "2026-10-09");
  check("deleted player leaves coach rosters", r2.ok && r2.value.players.length === 0);
  await account.deleteAllData(coach);
  check("coach deletion removes their teams", (await teams.listMine(coach)).length === 0);

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
