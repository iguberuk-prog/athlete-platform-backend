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

export interface DailyCheckIn {
  id: string;
  ownerId: string;
  /** The profile this check-in belongs to. */
  profileId: string;
  /** ISO-8601 date (YYYY-MM-DD). One check-in per profile per date. */
  date: string;

  sleepHoursLastNight?: number;
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
