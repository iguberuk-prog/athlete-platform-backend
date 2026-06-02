/**
 * Lightweight end-to-end test harness (no framework needed).
 *
 * Exercises profiles + daily check-ins against an in-memory SQLite database:
 *   - profile create + validation success
 *   - validation failures (allergy shape, numeric bounds, contradictory diets,
 *     missing soccer position, age determinability, out-of-range scale)
 *   - owner-only access
 *   - update / delete
 *   - check-in logging, validation, owner/profile scoping, one-per-day upsert
 *
 * Run with:  npm test
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
    // lactose intolerant -> Greek yogurt filtered out of recovery foods
    const allFoods = plan.blocks.flatMap((b) => b.foods || []);
    check("lactose intolerant excludes Greek yogurt", !allFoods.includes("Greek yogurt"));
    // a vegan profile -> no animal proteins suggested
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
    const noTomorrow = buildGameDayTimeline(fp, { date: "2026-06-02", kickoff: "19:00", playsTomorrow: false });
    check("no-game-tomorrow night routine differs", noTomorrow.nextDay.playsTomorrow === false);
  } else {
    check("timeline profile available", false);
  }

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
