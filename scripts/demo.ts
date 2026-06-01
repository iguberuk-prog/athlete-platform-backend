/**
 * Demo: create a profile and log a daily check-in, then print both.
 * Living documentation of the profile + check-in shapes.
 *
 * Run with:  npm run demo
 */

import { openDatabase } from "../src/data/db.js";
import {
  SqliteAthleteProfileRepository,
  SqliteCheckInRepository,
} from "../src/data/sqliteRepository.js";
import { ProfileService } from "../src/services/profileService.js";
import { CheckInService } from "../src/services/checkinService.js";
import type { ProfileInput } from "../src/domain/profile.js";

const profileInput: ProfileInput = {
  timezone: "Europe/Madrid",
  identity: { fullName: "Sample Player", dateOfBirth: "2005-02-20", sex: "female", school: "Madrid HS", graduationYear: 2027 },
  contact: { athleteEmail: "sample@example.com", emergencyContact: { name: "Sam Sr.", phone: "+34 600 000 000" } },
  sport: {
    primarySport: "soccer",
    positions: ["winger"],
    competitionLevel: "high_school",
    yearsPlaying: 9,
    dominantFoot: "left",
    seasonStatus: "in_season",
  },
  anthropometrics: { heightCm: 168, bodyMassKg: 61, bodyFatPct: 18 },
  training: { trainingDaysPerWeek: 5, avgSessionMinutes: 80, intensity: "high", matchesPerWeek: 2, strengthSessionsPerWeek: 2 },
  nutrition: {
    allergies: [{ allergen: "shellfish", severity: "moderate" }],
    dietaryRestrictions: ["pescatarian"],
    intolerances: ["lactose"],
    preferredDiet: "pescatarian",
    dislikes: ["mushrooms"],
    mealsPerDay: 4,
    mealPattern: "three_meals_plus_snacks",
    waterIntakeLitres: 2.5,
    caffeineMgPerDay: 80,
  },
  recovery: { avgSleepHours: 8, sleepQuality: 7, napFrequency: "rarely", recoveryMethods: ["stretching"] },
  health: { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [] },
  goals: { goals: ["improve_endurance", "improve_game_day_performance"], seasonGoals: "Be available for every fixture" },
  schedule: {
    events: [
      { type: "match", startTime: "2026-06-03T20:00:00+02:00", conditions: "warm, humid", importance: "high" },
      { type: "recovery", startTime: "2026-06-04T10:00:00+02:00", importance: "normal" },
    ],
  },
};

async function main(): Promise<void> {
  const db = openDatabase(":memory:");
  const profileRepo = new SqliteAthleteProfileRepository(db);
  const profiles = new ProfileService(profileRepo);
  const checkins = new CheckInService(new SqliteCheckInRepository(db), profileRepo);
  const owner = "demo-owner";

  const created = await profiles.create(owner, profileInput);
  if (!created.ok) {
    console.error("Profile validation failed:", created);
    process.exit(1);
  }
  console.log("Created profile:\n");
  console.log(JSON.stringify(created.value, null, 2));

  const checkin = await checkins.log(owner, {
    profileId: created.value.id,
    date: "2026-06-03",
    sleepHoursLastNight: 7,
    energyLevel: 8,
    stressLevel: 4,
    hydrationLevel: 6,
    sorenessLevel: 3,
    mood: "good",
    trainingPlanned: "match @ 20:00",
  });
  console.log("\nLogged check-in:\n");
  console.log(JSON.stringify(checkin, null, 2));
  db.close();
}

main();
