/**
 * The athlete profile — system of record for everything personal.
 *
 * Organised into clear groups so the recommendation engine can consume exactly
 * what it needs and privacy controls can be reasoned about per section:
 *
 *   identity        who they are (name, DOB, sex, school, etc.)
 *   contact         emails / phones / emergency contact
 *   sport           sport(s), position(s), level, season status
 *   anthropometrics height, weight, body-fat, mass history
 *   training        weekly training load
 *   nutrition       allergies, restrictions, preferences, intake habits
 *   recovery        baseline sleep & recovery habits
 *   health          injuries, conditions, medications, illness
 *   goals           what they want this season
 *   advanced        optional wearable / physiology data
 *   schedule        upcoming events + travel/tournament context
 *
 * Duplicates from the original field list were merged:
 *   - "Age" + "Date of Birth": dateOfBirth is the source of truth; age is
 *     derived (effectiveAge). An explicit age may be given if DOB is withheld.
 *   - "Allergies"/"Dietary Restrictions" listed twice -> live once, in nutrition.
 *   - "Past Major Injuries"/"Injury History" -> health.injuryHistory.
 *   - "Current Medications"/"Medications" -> health.medications.
 *   - "Height"/"Weight" listed twice -> anthropometrics only.
 *   - "Primary sport"/"Position"/"Competition level" repeated -> sport only.
 *
 * Most fields are OPTIONAL so partial profiles are valid and can be completed
 * over time. A small required core is enforced in validation.ts.
 */

import type {
  Allergen,
  AllergySeverity,
  CompetitionLevel,
  Diet,
  DominantFoot,
  EventImportance,
  EventType,
  Goal,
  IllnessStatus,
  Intolerance,
  MedicalDietId,
  MealPattern,
  NapFrequency,
  PreferredDiet,
  RecoveryMethod,
  SeasonStatus,
  Sex,
  Sport,
  TrainingIntensity,
  Wearable,
} from "./enums.js";

// --- shared value objects --------------------------------------------------

export interface MassReading {
  /** ISO-8601 date (YYYY-MM-DD). */
  date: string;
  bodyMassKg: number;
}

export interface EmergencyContact {
  name: string;
  relationship?: string;
  phone: string;
  email?: string;
}

export interface AllergyEntry {
  allergen: Allergen;
  severity: AllergySeverity;
  /** Required when allergen === "other" (e.g. "kiwi"). Matched against food names. */
  note?: string;
  /** Has had anaphylaxis (a severe whole-body reaction). */
  anaphylaxis?: boolean;
  /** Carries an epinephrine auto-injector (EpiPen). */
  epinephrine?: boolean;
  /** Also avoid "may contain" / shared-equipment foods. */
  avoidCrossContact?: boolean;
}

export interface InjuryRecord {
  /** e.g. "left ACL tear". */
  description: string;
  /** ISO-8601 date if known. */
  date?: string;
  /** Whether it is currently affecting the athlete. */
  ongoing?: boolean;
}

// --- profile sections ------------------------------------------------------

export interface Identity {
  fullName: string;
  /** Profile photo as a data URL (small square JPEG), stored on the profile. */
  avatarUrl?: string;
  /** Friendly auto-generated display code, e.g. SOC-K7F2Q (not used for ownership). */
  playerCode?: string;
  /** ISO-8601 date (YYYY-MM-DD). Source of truth for age. */
  dateOfBirth?: string;
  /** Explicit age, used only if dateOfBirth is not provided. */
  age?: number;
  sex: Sex;
  hometown?: string;
  graduationYear?: number;
  school?: string;
  clubTeam?: string;
  jerseyNumber?: number;
}

export interface Contact {
  athleteEmail?: string;
  parentEmail?: string;
  athletePhone?: string;
  parentPhone?: string;
  emergencyContact?: EmergencyContact;
}

export interface SportProfile {
  primarySport: Sport;
  secondarySports?: Sport[];
  /** Free-form when not soccer; soccer positions are validated against enum. */
  positions: string[];
  competitionLevel: CompetitionLevel;
  yearsPlaying?: number;
  dominantFoot?: DominantFoot;
  seasonStatus?: SeasonStatus;
}

export interface HeightReading {
  /** ISO-8601 date (YYYY-MM-DD). */
  date: string;
  heightCm: number;
}

export interface Anthropometrics {
  heightCm: number;
  bodyMassKg: number;
  bodyFatPct?: number;
  massHistory?: MassReading[];
  /** Height over time, for growth-spurt tracking in young players. */
  heightHistory?: HeightReading[];
}

export interface TrainingProfile {
  trainingDaysPerWeek?: number;
  avgSessionMinutes?: number;
  intensity?: TrainingIntensity;
  matchesPerWeek?: number;
  strengthSessionsPerWeek?: number;
}

export interface Nutrition {
  allergies: AllergyEntry[];
  /** Hard dietary restrictions (halal, vegan, gluten_free, ...). */
  dietaryRestrictions: Diet[];
  intolerances: Intolerance[];
  /** Single lifestyle diet preference; "none" allowed. */
  preferredDiet?: PreferredDiet;
  dislikes: string[];
  mealsPerDay?: number;
  mealPattern?: MealPattern;
  waterIntakeLitres?: number;
  caffeineMgPerDay?: number;
  /** Free-text supplement names the athlete uses. */
  supplements?: string[];
  /** Medical diets: celiac, type 1 diabetes, sensitive stomach, low-FODMAP. Private health data. */
  medicalDiets?: MedicalDietId[];
  /** When the athlete or parent confirmed the food-safety summary (ISO datetime). */
  safetyConfirmedAt?: string;
}

export interface RecoveryProfile {
  avgSleepHours?: number;
  /** Subjective 1-10. */
  sleepQuality?: number;
  napFrequency?: NapFrequency;
  recoveryMethods?: RecoveryMethod[];
  /** Baseline soreness 1-10 (daily value is captured in check-ins). */
  baselineSoreness?: number;
  /** Baseline energy 1-10 (daily value is captured in check-ins). */
  baselineEnergy?: number;
}

export interface AsthmaInfo {
  /** Has asthma or exercise-induced bronchoconstriction. */
  has: boolean;
  /** Doctor says to use the inhaler before exercise. */
  preExerciseInhaler?: boolean;
  /** Known triggers, e.g. cold air, pollen, smoke. */
  triggers?: string[];
}

/** One step of the CDC HEADS UP return-to-sport ladder (0 = resting, 6 = full game play). */
export interface ConcussionStepLog {
  step: number;
  date: string;
  /** Symptoms came back at this step. */
  symptoms?: boolean;
}

export interface ConcussionCase {
  id: string;
  /** Date of the hit or suspected concussion (YYYY-MM-DD). */
  date: string;
  notes?: string;
  /** Current step 0-6 on the return-to-sport ladder. */
  step: number;
  stepHistory: ConcussionStepLog[];
  /** Name of the health care provider who cleared return to play. */
  clearedBy?: string;
  /** Date cleared for full play. Only a provider can clear. */
  clearedAt?: string;
}

export interface HealthProfile {
  injuryHistory: InjuryRecord[];
  currentInjuries: InjuryRecord[];
  /** Conditions that affect nutrition or exercise (free text). */
  medicalConditions: string[];
  medications: string[];
  recentIllnessStatus?: IllnessStatus;
  fitnessNotes?: string;
  asthma?: AsthmaInfo;
  concussions?: ConcussionCase[];
}

export interface GoalsProfile {
  /** Structured, multi-select goals. */
  goals: Goal[];
  /** Free-text season goal, e.g. "make the starting XI". */
  seasonGoals?: string;
}

export interface AdvancedMetrics {
  restingHeartRate?: number;
  /** Heart-rate variability in ms. */
  hrvMs?: number;
  wearables?: Wearable[];
  sweatRateLitresPerHour?: number;
  estimatedCalorieExpenditure?: number;
  /** Optional and only if relevant to the athlete. */
  menstrualCycleTracking?: boolean;
  /** Field sweat tests; sweatRateLitresPerHour is the median of these. */
  sweatTests?: SweatTest[];
  /** Typical cycle length in days (opt-in). */
  cycleLengthDays?: number;
}

export interface SweatTest {
  id: string;
  date: string;
  preKg: number;
  postKg: number;
  /** Fluid drunk during the session, litres. */
  fluidL: number;
  /** Urine passed during the session, litres (usually 0). */
  urineL?: number;
  minutes: number;
  /** Feels-like temperature, °F, if known. */
  tempF?: number;
  /** Computed litres per hour. */
  rateLph: number;
  /** Percent of body mass lost. */
  lossPct: number;
}

export interface ScheduledEvent {
  type: EventType;
  /** Stable id for events imported from a team calendar feed. */
  uid?: string;
  /** Where it came from: "manual" or the calendar feed id. */
  source?: string;
  title?: string;
  location?: string;
  /** Minutes long, if known. */
  durationMin?: number;
  /** 5-digit US ZIP of the field, for the weather forecast. Defaults to the home ZIP. */
  zip?: string;
  /** ISO-8601 datetime with offset, e.g. 2026-06-02T19:00:00+01:00. */
  startTime: string;
  conditions?: string;
  importance: EventImportance;
}

export interface Schedule {
  events: ScheduledEvent[];
  /** ISO-8601 dates the athlete is travelling. */
  travelDays?: string[];
  /** ISO-8601 dates (typically weekends) of tournaments. */
  tournamentWeekends?: string[];
  /** Subscribed team calendars. */
  feeds?: CalendarFeed[];
  /** First day of preseason, for the 14-day heat acclimatization plan. */
  preseasonStart?: string;
}

/** Daily routine used to anchor plans and reminders. */
export interface Routine {
  /** HH:MM, local time. */
  wakeTime?: string;
  /** HH:MM, local time. */
  bedTime?: string;
  /** HH:MM usual practice start, used when a practice has no time. */
  usualPracticeTime?: string;
  /** 5-digit US ZIP where the athlete usually trains, for the weather forecast. */
  homeZip?: string;
  /** School day, so meals and snacks fit around classes. */
  school?: SchoolDay;
}

export interface SchoolDay {
  /** 0 = Sunday ... 6 = Saturday. Usually [1,2,3,4,5]. */
  days: number[];
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
  /** HH:MM lunch start. */
  lunch?: string;
  /** Can eat a snack between classes. */
  snackBreak?: boolean;
}

/** A team calendar the athlete subscribed to (TeamSnap, SportsEngine, PlayMetrics, ...). */
export interface CalendarFeed {
  id: string;
  /** https:// or webcal:// subscription link. For sign-in feeds, "teamsnap:<teamId>" or "google:<calendarId>". */
  url: string;
  /** How it's read: a calendar link (default), or a signed-in TeamSnap team or Google calendar. */
  kind?: "ics" | "teamsnap" | "google";
  /** Which team app it came from (see TEAM_APPS). */
  app?: string;
  /** Google only: words that mark an event as a soccer event, e.g. ["soccer", "Lions U14"]. */
  keywords?: string[];
  name?: string;
  /** ZIP used when an event's address has no ZIP. */
  defaultZip?: string;
  lastSyncedAt?: string;
  lastError?: string;
  eventCount?: number;
}

// --- the full profile ------------------------------------------------------

export interface AthleteProfile {
  id: string;
  /** The single athlete who owns (and can access) this profile. */
  ownerId: string;
  /** IANA timezone, e.g. "Europe/London". Drives time-of-day-aware planning. */
  timezone: string;

  identity: Identity;
  contact?: Contact;
  sport: SportProfile;
  anthropometrics: Anthropometrics;
  training?: TrainingProfile;
  nutrition: Nutrition;
  recovery?: RecoveryProfile;
  health?: HealthProfile;
  goals?: GoalsProfile;
  advanced?: AdvancedMetrics;
  schedule?: Schedule;
  routine?: Routine;
  notifications?: { weeklyReport?: boolean };
  /** Fun settings: fuel buddy name and color, playlist genres. */
  fun?: { buddyName?: string; buddyColor?: string; genres?: string[] };

  createdAt: string;
  updatedAt: string;
}

/** Shape a client sends to create/replace a profile (no system-managed fields). */
export type ProfileInput = Omit<
  AthleteProfile,
  "id" | "ownerId" | "createdAt" | "updatedAt"
>;

/**
 * Derived age: prefers dateOfBirth, falls back to an explicit age.
 * Returns undefined if neither is usable.
 */
export function effectiveAge(
  identity: Pick<Identity, "dateOfBirth" | "age">,
  now: Date = new Date(),
): number | undefined {
  if (identity.dateOfBirth) {
    const dob = new Date(identity.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      return age;
    }
  }
  return typeof identity.age === "number" ? identity.age : undefined;
}
