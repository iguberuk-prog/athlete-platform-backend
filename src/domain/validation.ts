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
  MEDICAL_DIETS,
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
import { BODY_REGIONS, CYCLE_SYMPTOMS, type CheckInInput } from "./checkin.js";

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

  if (id.avatarUrl !== undefined && id.avatarUrl !== null) {
    if (typeof id.avatarUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(id.avatarUrl)) {
      errors.push({ path: "identity.avatarUrl", message: "must be an uploaded photo" });
    } else if (id.avatarUrl.length > 300_000) {
      errors.push({ path: "identity.avatarUrl", message: "photo is too large" });
    }
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
  if (n.medicalDiets !== undefined)
    arrayCheck(errors, "nutrition.medicalDiets", n.medicalDiets, false, (v, i) =>
      enumCheck(errors, `nutrition.medicalDiets[${i}]`, v, MEDICAL_DIETS, true),
    );
  if (n.safetyConfirmedAt !== undefined && !isISODate(n.safetyConfirmedAt))
    errors.push({ path: "nutrition.safetyConfirmedAt", message: "must be an ISO datetime" });
  (isArray(n.allergies) ? n.allergies : []).forEach((a, i) => {
    for (const k of ["anaphylaxis", "epinephrine", "avoidCrossContact"] as const) {
      const v = (a as unknown as Record<string, unknown>)?.[k];
      if (v !== undefined && !isBool(v)) errors.push({ path: `nutrition.allergies[${i}].${k}`, message: "must be true or false" });
    }
  });
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
  if (h.asthma !== undefined) {
    const a = h.asthma as unknown as Record<string, unknown>;
    if (!a || typeof a !== "object" || !isBool(a.has)) errors.push({ path: "health.asthma.has", message: "must be a boolean" });
    else {
      if (a.preExerciseInhaler !== undefined && !isBool(a.preExerciseInhaler))
        errors.push({ path: "health.asthma.preExerciseInhaler", message: "must be a boolean" });
      if (a.triggers !== undefined) arrayCheck(errors, "health.asthma.triggers", a.triggers, false, (v, i) => {
        if (!isNonEmptyString(v) || v.length > 60) errors.push({ path: `health.asthma.triggers[${i}]`, message: "must be short text" });
      });
    }
  }
  if (h.concussions !== undefined)
    arrayCheck(errors, "health.concussions", h.concussions, false, (v, i) => {
      const c = v as Record<string, unknown>;
      if (!c || !isNonEmptyString(c.id) || !isDay(c.date) || !isNumber(c.step) || (c.step as number) < 0 || (c.step as number) > 6)
        errors.push({ path: `health.concussions[${i}]`, message: "needs id, date and step 0-6" });
    });
}

const isDay = (v: unknown): boolean => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

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
  rangeCheck(errors, "advanced.cycleLengthDays", a.cycleLengthDays, { min: 15, max: 60 }, false);
  if (a.sweatTests !== undefined) arrayCheck(errors, "advanced.sweatTests", a.sweatTests, false);
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
  if (s.preseasonStart !== undefined && !isDay(s.preseasonStart))
    errors.push({ path: "schedule.preseasonStart", message: "must be a date in YYYY-MM-DD format" });
  if (s.feeds !== undefined)
    arrayCheck(errors, "schedule.feeds", s.feeds, false, (v, i) => {
      const f = v as unknown as Record<string, unknown>;
      if (!f || !isNonEmptyString(f.id) || !isFeedUrl(f.url))
        errors.push({ path: `schedule.feeds[${i}].url`, message: "must be an https:// or webcal:// calendar link" });
      if (f && f.defaultZip !== undefined && !isZip(f.defaultZip))
        errors.push({ path: `schedule.feeds[${i}].defaultZip`, message: "must be a 5-digit ZIP code" });
    });
  for (const field of ["travelDays", "tournamentWeekends"] as const) {
    if (s[field] !== undefined)
      arrayCheck(errors, `schedule.${field}`, s[field], false, (v, i) => {
        if (!isISODate(v)) errors.push({ path: `schedule.${field}[${i}]`, message: "must be an ISO-8601 date" });
      });
  }
}

const isZip = (v: unknown): boolean => typeof v === "string" && /^\d{5}$/.test(v);

const isHHMM = (v: unknown): boolean =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function validateRoutine(errors: ValidationError[], input: ProfileInput): void {
  const r = input.routine;
  if (r === undefined) return;
  if (!r || typeof r !== "object") {
    errors.push({ path: "routine", message: "must be an object" });
    return;
  }
  for (const f of ["wakeTime", "bedTime", "usualPracticeTime"] as const) {
    if (r[f] !== undefined && !isHHMM(r[f])) errors.push({ path: `routine.${f}`, message: "must be HH:MM" });
  }
  if (r.homeZip !== undefined && !isZip(r.homeZip)) errors.push({ path: "routine.homeZip", message: "must be a 5-digit ZIP code" });
  if (r.school !== undefined) {
    const sc = r.school as unknown as Record<string, unknown>;
    if (!sc || typeof sc !== "object" || !isArray(sc.days) || !(sc.days as unknown[]).every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))
      errors.push({ path: "routine.school.days", message: "must be weekday numbers 0-6" });
    else {
      for (const f of ["start", "end"]) if (!isHHMM(sc[f])) errors.push({ path: `routine.school.${f}`, message: "must be HH:MM" });
      if (sc.lunch !== undefined && !isHHMM(sc.lunch)) errors.push({ path: "routine.school.lunch", message: "must be HH:MM" });
      if (isHHMM(sc.start) && isHHMM(sc.end) && String(sc.end) <= String(sc.start))
        errors.push({ path: "routine.school.end", message: "must be after the start time" });
    }
  }
}

export const isFeedUrl = (v: unknown): boolean => {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    const u = new URL(v.replace(/^webcal:/i, "https:"));
    return u.protocol === "https:" && !!u.hostname && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) && !u.hostname.endsWith(".local");
  } catch { return false; }
};

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
  validateRoutine(errors, input);
  if (input.fun !== undefined) {
    const f = input.fun as unknown as Record<string, unknown>;
    if (!f || typeof f !== "object") errors.push({ path: "fun", message: "must be an object" });
    else {
      if (f.buddyName !== undefined && !(isString(f.buddyName) && f.buddyName.trim().length >= 1 && f.buddyName.length <= 20)) errors.push({ path: "fun.buddyName", message: "must be 1-20 characters" });
      if (f.buddyColor !== undefined && !isString(f.buddyColor)) errors.push({ path: "fun.buddyColor", message: "must be text" });
      if (f.genres !== undefined) arrayCheck(errors, "fun.genres", f.genres, false, (v, i) => { if (!isString(v) || v.length > 20) errors.push({ path: `fun.genres[${i}]`, message: "must be short text" }); });
    }
  }
  if (input.notifications !== undefined) {
    const n = input.notifications as unknown as Record<string, unknown>;
    if (!n || typeof n !== "object" || (n.weeklyReport !== undefined && !isBool(n.weeklyReport)))
      errors.push({ path: "notifications.weeklyReport", message: "must be a boolean" });
  }

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
  rangeCheck(errors, "sessionMinutes", input.sessionMinutes, BOUNDS.sessionMinutes, false);
  scaleCheck(errors, "sessionRpe", input.sessionRpe);
  rangeCheck(errors, "urineColor", input.urineColor, { min: 1, max: 8 }, false);
  if (input.urineColor !== undefined && !Number.isInteger(input.urineColor)) errors.push({ path: "urineColor", message: "must be a whole number 1-8" });
  scaleCheck(errors, "enjoyment", input.enjoyment);
  rangeCheck(errors, "schoolLoad", input.schoolLoad, { min: 0, max: 16 }, false);
  for (const f of ["sick", "fever", "headSymptoms", "inhalerUsed", "warmupDone", "breathingDone", "period"] as const) {
    if (input[f] !== undefined && !isBool(input[f])) errors.push({ path: f, message: "must be a boolean" });
  }
  if (input.soreSpots !== undefined)
    arrayCheck(errors, "soreSpots", input.soreSpots, false, (v, i) => {
      const s = v as unknown as Record<string, unknown>;
      if (!s) { errors.push({ path: `soreSpots[${i}]`, message: "is required" }); return; }
      enumCheck(errors, `soreSpots[${i}].region`, s.region, BODY_REGIONS, true);
      scaleCheck(errors, `soreSpots[${i}].level`, s.level);
      if (s.level === undefined) errors.push({ path: `soreSpots[${i}].level`, message: "is required" });
    });
  if (input.soreSpots && input.soreSpots.length > BODY_REGIONS.length) errors.push({ path: "soreSpots", message: "too many" });
  if (input.cycleSymptoms !== undefined)
    arrayCheck(errors, "cycleSymptoms", input.cycleSymptoms, false, (v, i) => enumCheck(errors, `cycleSymptoms[${i}]`, v, CYCLE_SYMPTOMS, true));
  if (input.source !== undefined && !(isString(input.source) && input.source.length <= 30)) errors.push({ path: "source", message: "must be short text" });

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
    for (const f of ["title", "location"]) if (ev[f] !== undefined && !(isString(ev[f]) && (ev[f] as string).length <= 200))
      errors.push({ path: `${base}.${f}`, message: "must be text under 200 characters" });
    if (ev.durationMin !== undefined && !(isNumber(ev.durationMin) && ev.durationMin > 0 && ev.durationMin <= 720))
      errors.push({ path: `${base}.durationMin`, message: "must be 1-720 minutes" });
    if (ev.zip !== undefined && !(typeof ev.zip === "string" && /^\d{5}$/.test(ev.zip)))
      errors.push({ path: `${base}.zip`, message: "must be a 5-digit ZIP code" });
  });
  return { valid: errors.length === 0, errors };
}

