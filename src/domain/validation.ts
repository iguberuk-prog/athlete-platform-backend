/**
 * Safety validation for athlete profiles and daily check-ins.
 *
 * Returns `{ valid, errors }`; never throws. Each error has a `path` so a client
 * can show the message next to the right field.
 *
 * Philosophy:
 *   - A small REQUIRED CORE must always be present and correct.
 *   - Everything else is OPTIONAL but validated IF PRESENT (right type, known
 *     enum value, plausible number / 1-10 scale).
 *   - Allergies and dietary restrictions get extra care because they are the
 *     safety-critical, "never violate" part of the profile.
 */

import {
  ALLERGENS,
  ALLERGY_SEVERITIES,
  BOUNDS,
  COMPETITION_LEVELS,
  DIETS,
  DOMINANT_FEET,
  EVENT_IMPORTANCE,
  EVENT_TYPES,
  GOALS,
  ILLNESS_STATUSES,
  INTOLERANCES,
  MEAL_PATTERNS,
  MOODS,
  NAP_FREQUENCIES,
  PREFERRED_DIETS,
  RECOVERY_METHODS,
  SCALE_MAX,
  SCALE_MIN,
  SEASON_STATUSES,
  SEXES,
  SOCCER_POSITIONS,
  SPORTS,
  TRAINING_INTENSITIES,
  WEARABLES,
} from "./enums.js";
import { effectiveAge, type ProfileInput } from "./profile.js";
import type { CheckInInput } from "./checkin.js";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// --- primitives ------------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isISODate = (v: unknown): boolean =>
  isNonEmptyString(v) && !Number.isNaN(Date.parse(v));

function enumCheck(
  errors: ValidationError[],
  path: string,
  v: unknown,
  set: readonly string[],
  required: boolean,
): void {
  if (v === undefined || v === null) {
    if (required) errors.push({ path, message: "is required" });
    return;
  }
  if (!isString(v) || !set.includes(v)) {
    errors.push({ path, message: `must be one of: ${set.join(", ")}` });
  }
}

function rangeCheck(
  errors: ValidationError[],
  path: string,
  v: unknown,
  bounds: { min: number; max: number },
  required: boolean,
): void {
  if (v === undefined || v === null) {
    if (required) errors.push({ path, message: "is required" });
    return;
  }
  if (!isNumber(v)) {
    errors.push({ path, message: "must be a number" });
    return;
  }
  if (v < bounds.min || v > bounds.max) {
    errors.push({ path, message: `must be between ${bounds.min} and ${bounds.max}` });
  }
}

function scaleCheck(errors: ValidationError[], path: string, v: unknown): void {
  if (v === undefined || v === null) return;
  if (!isNumber(v) || v < SCALE_MIN || v > SCALE_MAX) {
    errors.push({ path, message: `must be a number between ${SCALE_MIN} and ${SCALE_MAX}` });
  }
}

function arrayCheck(
  errors: ValidationError[],
  path: string,
  v: unknown,
  required: boolean,
  each?: (item: unknown, i: number) => void,
): void {
  if (v === undefined || v === null) {
    if (required) errors.push({ path, message: "is required" });
    return;
  }
  if (!isArray(v)) {
    errors.push({ path, message: "must be an array" });
    return;
  }
  if (each) v.forEach((item, i) => each(item, i));
}

// --- profile sections ------------------------------------------------------

function validateIdentity(errors: ValidationError[], input: ProfileInput): void {
  const id = input.identity;
  if (!id || typeof id !== "object") {
    errors.push({ path: "identity", message: "is required" });
    return;
  }
  if (!isNonEmptyString(id.fullName)) {
    errors.push({ path: "identity.fullName", message: "is required" });
  }
  enumCheck(errors, "identity.sex", id.sex, SEXES, true);

  if (id.dateOfBirth !== undefined && !isISODate(id.dateOfBirth)) {
    errors.push({ path: "identity.dateOfBirth", message: "must be an ISO-8601 date" });
  }
  const age = effectiveAge(id);
  if (age === undefined) {
    errors.push({ path: "identity.dateOfBirth", message: "either dateOfBirth or age is required" });
  } else if (age < BOUNDS.age.min || age > BOUNDS.age.max) {
    errors.push({ path: "identity.age", message: `age must be between ${BOUNDS.age.min} and ${BOUNDS.age.max}` });
  }

  if (id.graduationYear !== undefined && !isNumber(id.graduationYear)) {
    errors.push({ path: "identity.graduationYear", message: "must be a number" });
  }
  if (id.jerseyNumber !== undefined && !isNumber(id.jerseyNumber)) {
    errors.push({ path: "identity.jerseyNumber", message: "must be a number" });
  }
}

function validateSport(errors: ValidationError[], input: ProfileInput): void {
  const s = input.sport;
  if (!s || typeof s !== "object") {
    errors.push({ path: "sport", message: "is required" });
    return;
  }
  enumCheck(errors, "sport.primarySport", s.primarySport, SPORTS, true);
  enumCheck(errors, "sport.competitionLevel", s.competitionLevel, COMPETITION_LEVELS, true);

  if (s.secondarySports !== undefined) {
    arrayCheck(errors, "sport.secondarySports", s.secondarySports, false, (v, i) =>
      enumCheck(errors, `sport.secondarySports[${i}]`, v, SPORTS, true),
    );
  }

  arrayCheck(errors, "sport.positions", s.positions, true, (v, i) => {
    if (s.primarySport === "soccer") {
      enumCheck(errors, `sport.positions[${i}]`, v, SOCCER_POSITIONS, true);
    } else if (!isNonEmptyString(v)) {
      errors.push({ path: `sport.positions[${i}]`, message: "must be a non-empty string" });
    }
  });
  if (isArray(s.positions) && s.positions.length === 0) {
    errors.push({ path: "sport.positions", message: "at least one position is required" });
  }

  if (s.dominantFoot !== undefined)
    enumCheck(errors, "sport.dominantFoot", s.dominantFoot, DOMINANT_FEET, false);
  if (s.seasonStatus !== undefined)
    enumCheck(errors, "sport.seasonStatus", s.seasonStatus, SEASON_STATUSES, false);
  if (s.yearsPlaying !== undefined)
    rangeCheck(errors, "sport.yearsPlaying", s.yearsPlaying, BOUNDS.yearsPlaying, false);
}

function validateAnthropometrics(errors: ValidationError[], input: ProfileInput): void {
  const a = input.anthropometrics;
  if (!a || typeof a !== "object") {
    errors.push({ path: "anthropometrics", message: "is required" });
    return;
  }
  rangeCheck(errors, "anthropometrics.heightCm", a.heightCm, BOUNDS.heightCm, true);
  rangeCheck(errors, "anthropometrics.bodyMassKg", a.bodyMassKg, BOUNDS.bodyMassKg, true);
  rangeCheck(errors, "anthropometrics.bodyFatPct", a.bodyFatPct, BOUNDS.bodyFatPct, false);
}

function validateNutrition(errors: ValidationError[], input: ProfileInput): void {
  const n = input.nutrition;
  if (!n || typeof n !== "object") {
    errors.push({ path: "nutrition", message: "is required" });
    return;
  }

  arrayCheck(errors, "nutrition.allergies", n.allergies, true, (a, i) => {
    const base = `nutrition.allergies[${i}]`;
    if (!a || typeof a !== "object") {
      errors.push({ path: base, message: "must be an object" });
      return;
    }
    const entry = a as Record<string, unknown>;
    enumCheck(errors, `${base}.allergen`, entry.allergen, ALLERGENS, true);
    enumCheck(errors, `${base}.severity`, entry.severity, ALLERGY_SEVERITIES, true);
    if (entry.allergen === "other" && !isNonEmptyString(entry.note)) {
      errors.push({ path: `${base}.note`, message: 'is required when allergen is "other"' });
    }
  });

  arrayCheck(errors, "nutrition.dietaryRestrictions", n.dietaryRestrictions, true, (v, i) =>
    enumCheck(errors, `nutrition.dietaryRestrictions[${i}]`, v, DIETS, true),
  );
  if (
    isArray(n.dietaryRestrictions) &&
    n.dietaryRestrictions.includes("vegan") &&
    n.dietaryRestrictions.includes("pescatarian")
  ) {
    errors.push({ path: "nutrition.dietaryRestrictions", message: "cannot be both vegan and pescatarian" });
  }

  arrayCheck(errors, "nutrition.intolerances", n.intolerances, true, (v, i) =>
    enumCheck(errors, `nutrition.intolerances[${i}]`, v, INTOLERANCES, true),
  );
  arrayCheck(errors, "nutrition.dislikes", n.dislikes, true);

  if (n.preferredDiet !== undefined)
    enumCheck(errors, "nutrition.preferredDiet", n.preferredDiet, PREFERRED_DIETS, false);
  if (n.mealPattern !== undefined)
    enumCheck(errors, "nutrition.mealPattern", n.mealPattern, MEAL_PATTERNS, false);
  rangeCheck(errors, "nutrition.mealsPerDay", n.mealsPerDay, BOUNDS.mealsPerDay, false);
  rangeCheck(errors, "nutrition.waterIntakeLitres", n.waterIntakeLitres, BOUNDS.waterIntakeLitres, false);
  rangeCheck(errors, "nutrition.caffeineMgPerDay", n.caffeineMgPerDay, BOUNDS.caffeineMgPerDay, false);
  if (n.supplements !== undefined) arrayCheck(errors, "nutrition.supplements", n.supplements, false);
}

function validateTraining(errors: ValidationError[], input: ProfileInput): void {
  const t = input.training;
  if (t === undefined) return;
  if (typeof t !== "object") {
    errors.push({ path: "training", message: "must be an object" });
    return;
  }
  rangeCheck(errors, "training.trainingDaysPerWeek", t.trainingDaysPerWeek, BOUNDS.trainingDaysPerWeek, false);
  rangeCheck(errors, "training.avgSessionMinutes", t.avgSessionMinutes, BOUNDS.avgSessionMinutes, false);
  rangeCheck(errors, "training.matchesPerWeek", t.matchesPerWeek, BOUNDS.matchesPerWeek, false);
  rangeCheck(errors, "training.strengthSessionsPerWeek", t.strengthSessionsPerWeek, BOUNDS.strengthSessionsPerWeek, false);
  if (t.intensity !== undefined)
    enumCheck(errors, "training.intensity", t.intensity, TRAINING_INTENSITIES, false);
}

function validateRecovery(errors: ValidationError[], input: ProfileInput): void {
  const r = input.recovery;
  if (r === undefined) return;
  if (typeof r !== "object") {
    errors.push({ path: "recovery", message: "must be an object" });
    return;
  }
  rangeCheck(errors, "recovery.avgSleepHours", r.avgSleepHours, BOUNDS.avgSleepHours, false);
  scaleCheck(errors, "recovery.sleepQuality", r.sleepQuality);
  scaleCheck(errors, "recovery.baselineSoreness", r.baselineSoreness);
  scaleCheck(errors, "recovery.baselineEnergy", r.baselineEnergy);
  if (r.napFrequency !== undefined)
    enumCheck(errors, "recovery.napFrequency", r.napFrequency, NAP_FREQUENCIES, false);
  if (r.recoveryMethods !== undefined)
    arrayCheck(errors, "recovery.recoveryMethods", r.recoveryMethods, false, (v, i) =>
      enumCheck(errors, `recovery.recoveryMethods[${i}]`, v, RECOVERY_METHODS, true),
    );
}

function validateHealth(errors: ValidationError[], input: ProfileInput): void {
  const h = input.health;
  if (h === undefined) return;
  if (typeof h !== "object") {
    errors.push({ path: "health", message: "must be an object" });
    return;
  }
  const injuryEach = (basePath: string) => (v: unknown, i: number) => {
    if (!v || typeof v !== "object" || !isNonEmptyString((v as Record<string, unknown>).description)) {
      errors.push({ path: `${basePath}[${i}].description`, message: "is required" });
    }
  };
  if (h.injuryHistory !== undefined)
    arrayCheck(errors, "health.injuryHistory", h.injuryHistory, false, injuryEach("health.injuryHistory"));
  if (h.currentInjuries !== undefined)
    arrayCheck(errors, "health.currentInjuries", h.currentInjuries, false, injuryEach("health.currentInjuries"));
  if (h.medicalConditions !== undefined)
    arrayCheck(errors, "health.medicalConditions", h.medicalConditions, false);
  if (h.medications !== undefined) arrayCheck(errors, "health.medications", h.medications, false);
  if (h.recentIllnessStatus !== undefined)
    enumCheck(errors, "health.recentIllnessStatus", h.recentIllnessStatus, ILLNESS_STATUSES, false);
}

function validateGoals(errors: ValidationError[], input: ProfileInput): void {
  const g = input.goals;
  if (g === undefined) return;
  if (typeof g !== "object") {
    errors.push({ path: "goals", message: "must be an object" });
    return;
  }
  if (g.goals !== undefined)
    arrayCheck(errors, "goals.goals", g.goals, false, (v, i) =>
      enumCheck(errors, `goals.goals[${i}]`, v, GOALS, true),
    );
}

function validateAdvanced(errors: ValidationError[], input: ProfileInput): void {
  const a = input.advanced;
  if (a === undefined) return;
  if (typeof a !== "object") {
    errors.push({ path: "advanced", message: "must be an object" });
    return;
  }
  rangeCheck(errors, "advanced.restingHeartRate", a.restingHeartRate, BOUNDS.restingHeartRate, false);
  rangeCheck(errors, "advanced.hrvMs", a.hrvMs, BOUNDS.hrvMs, false);
  rangeCheck(errors, "advanced.sweatRateLitresPerHour", a.sweatRateLitresPerHour, BOUNDS.sweatRateLitresPerHour, false);
  rangeCheck(errors, "advanced.estimatedCalorieExpenditure", a.estimatedCalorieExpenditure, BOUNDS.estimatedCalorieExpenditure, false);
  if (a.wearables !== undefined)
    arrayCheck(errors, "advanced.wearables", a.wearables, false, (v, i) =>
      enumCheck(errors, `advanced.wearables[${i}]`, v, WEARABLES, true),
    );
  if (a.menstrualCycleTracking !== undefined && !isBool(a.menstrualCycleTracking)) {
    errors.push({ path: "advanced.menstrualCycleTracking", message: "must be a boolean" });
  }
}

function validateSchedule(errors: ValidationError[], input: ProfileInput): void {
  const s = input.schedule;
  if (s === undefined) return;
  if (typeof s !== "object") {
    errors.push({ path: "schedule", message: "must be an object" });
    return;
  }
  if (s.events !== undefined) {
    arrayCheck(errors, "schedule.events", s.events, false, (e, i) => {
      const base = `schedule.events[${i}]`;
      const ev = e as Record<string, unknown>;
      enumCheck(errors, `${base}.type`, ev.type, EVENT_TYPES, true);
      if (!isISODate(ev.startTime))
        errors.push({ path: `${base}.startTime`, message: "must be an ISO-8601 datetime" });
      enumCheck(errors, `${base}.importance`, ev.importance, EVENT_IMPORTANCE, true);
    });
  }
  for (const field of ["travelDays", "tournamentWeekends"] as const) {
    if (s[field] !== undefined)
      arrayCheck(errors, `schedule.${field}`, s[field], false, (v, i) => {
        if (!isISODate(v)) errors.push({ path: `schedule.${field}[${i}]`, message: "must be an ISO-8601 date" });
      });
  }
}

// --- top-level: profile ----------------------------------------------------

export function validateProfileInput(input: ProfileInput): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(input.timezone)) {
    errors.push({ path: "timezone", message: "is required (IANA timezone)" });
  }
  validateIdentity(errors, input);
  validateSport(errors, input);
  validateAnthropometrics(errors, input);
  validateNutrition(errors, input);
  validateTraining(errors, input);
  validateRecovery(errors, input);
  validateHealth(errors, input);
  validateGoals(errors, input);
  validateAdvanced(errors, input);
  validateSchedule(errors, input);

  return { valid: errors.length === 0, errors };
}

// --- top-level: daily check-in ---------------------------------------------

export function validateCheckInInput(input: CheckInInput): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(input.profileId)) {
    errors.push({ path: "profileId", message: "is required" });
  }
  if (!isNonEmptyString(input.date) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) {
    errors.push({ path: "date", message: "must be a date in YYYY-MM-DD format" });
  }

  rangeCheck(errors, "sleepHoursLastNight", input.sleepHoursLastNight, BOUNDS.sleepHoursLastNight, false);
  scaleCheck(errors, "energyLevel", input.energyLevel);
  scaleCheck(errors, "stressLevel", input.stressLevel);
  scaleCheck(errors, "hydrationLevel", input.hydrationLevel);
  scaleCheck(errors, "sorenessLevel", input.sorenessLevel);
  if (input.mood !== undefined) enumCheck(errors, "mood", input.mood, MOODS, false);
  if (input.trainingCompleted !== undefined && !isBool(input.trainingCompleted)) {
    errors.push({ path: "trainingCompleted", message: "must be a boolean" });
  }
  rangeCheck(errors, "restingHeartRate", input.restingHeartRate, BOUNDS.restingHeartRate, false);
  rangeCheck(errors, "hrvMs", input.hrvMs, BOUNDS.hrvMs, false);

  return { valid: errors.length === 0, errors };
}

// --- standalone: schedule events (for the "add fixture" endpoint) ----------

export function validateEventInputs(events: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isArray(events) || events.length === 0) {
    errors.push({ path: "events", message: "must be a non-empty array" });
    return { valid: false, errors };
  }
  events.forEach((e, i) => {
    const base = `events[${i}]`;
    const ev = e as Record<string, unknown>;
    enumCheck(errors, `${base}.type`, ev.type, EVENT_TYPES, true);
    if (!isISODate(ev.startTime))
      errors.push({ path: `${base}.startTime`, message: "must be an ISO-8601 datetime" });
    if (ev.importance !== undefined)
      enumCheck(errors, `${base}.importance`, ev.importance, EVENT_IMPORTANCE, false);
  });
  return { valid: errors.length === 0, errors };
}

