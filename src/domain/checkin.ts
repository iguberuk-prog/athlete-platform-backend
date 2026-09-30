/**
 * Daily check-in — a lightweight, repeated log an athlete fills in each day.
 *
 * Unlike the profile (mostly set once and updated occasionally), check-ins are a
 * time series: one row per athlete per day. They are the highest-signal input to
 * recovery and readiness recommendations, because what an athlete should do today
 * depends on how they actually slept, how sore they are, and what training is
 * planned — none of which a static profile captures.
 *
 * All measures are optional so an athlete can log as little or as much as they
 * want; only the date is required.
 */

import type { Mood } from "./enums.js";

export const BODY_REGIONS = [
  "head", "neck", "shoulder_l", "shoulder_r", "back", "lower_back", "hip_l", "hip_r", "groin",
  "quad_l", "quad_r", "hamstring_l", "hamstring_r", "knee_l", "knee_r", "shin_l", "shin_r",
  "calf_l", "calf_r", "ankle_l", "ankle_r", "heel_l", "heel_r", "foot_l", "foot_r",
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

export const CYCLE_SYMPTOMS = ["cramps", "tired", "headache", "bloating", "low_mood", "heavy_flow"] as const;
export type CycleSymptom = (typeof CYCLE_SYMPTOMS)[number];

export interface SoreSpot {
  region: BodyRegion;
  level: number;
}

export interface DailyCheckIn {
  id: string;
  ownerId: string;
  /** The profile this check-in belongs to. */
  profileId: string;
  /** ISO-8601 date (YYYY-MM-DD). One check-in per profile per date. */
  date: string;

  sleepHoursLastNight?: number;
  /** Where the data came from, if a wearable filled it in. */
  source?: string;
  /** Subjective 1–10 scales. */
  energyLevel?: number;
  stressLevel?: number;
  hydrationLevel?: number;
  sorenessLevel?: number;
  mood?: Mood;

  /** Free-text description of training planned for today. */
  trainingPlanned?: string;
  /** Whether the planned training was completed. */
  trainingCompleted?: boolean;
  /** Minutes of training / match play today (for session load). */
  sessionMinutes?: number;
  /** Session effort 1-10 (RPE). Load = minutes x RPE (session-RPE method). */
  sessionRpe?: number;

  /** Urine color 1 (pale) to 8 (dark). 1-3 = well hydrated. */
  urineColor?: number;
  /** Where it hurts, 1-10 each. */
  soreSpots?: SoreSpot[];
  /** Fever, vomiting, or too sick to train. */
  sick?: boolean;
  fever?: boolean;
  /** Headache, dizziness, blurry vision, etc. after a hit. */
  headSymptoms?: boolean;
  /** Needed the rescue inhaler today. */
  inhalerUsed?: boolean;
  /** Did the injury-prevention warm-up. */
  warmupDone?: boolean;
  /** Did a breathing / wind-down exercise. */
  breathingDone?: boolean;
  /** Menstrual period today (opt-in). */
  period?: boolean;
  /** Cramps, fatigue, etc. that affect training (opt-in). */
  cycleSymptoms?: CycleSymptom[];
  /** Hours of homework/school stress, free signal for burnout. */
  schoolLoad?: number;
  /** Still enjoying the sport, 1-10. */
  enjoyment?: number;

  // Advanced / wearable-sourced (optional)
  restingHeartRate?: number;
  hrvMs?: number;

  notes?: string;
  createdAt: string;
}

/** Shape a client sends to log a check-in (no system-managed fields). */
export type CheckInInput = Omit<
  DailyCheckIn,
  "id" | "ownerId" | "createdAt"
>;
