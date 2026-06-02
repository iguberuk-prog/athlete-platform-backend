/**
 * Data-access contracts.
 *
 * Everything above this layer (services, functions) talks to these interfaces,
 * never to a concrete database — that is what lets us run on SQLite locally and
 * swap to Supabase/Postgres later without touching business logic.
 *
 * Owner scoping is baked into every signature: an implementation must only ever
 * return or mutate rows owned by the given `ownerId`. This is the enforcement
 * point for "a profile (and its check-ins) is private to its owner".
 */

import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import type { CheckInInput, DailyCheckIn } from "../domain/checkin.js";

export interface AthleteProfileRepository {
  create(ownerId: string, input: ProfileInput): Promise<AthleteProfile>;
  getById(ownerId: string, id: string): Promise<AthleteProfile | null>;
  listByOwner(ownerId: string): Promise<AthleteProfile[]>;
  /** Every profile across all owners. Admin-only — call sites must gate access. */
  listAll(): Promise<AthleteProfile[]>;
  update(ownerId: string, id: string, input: ProfileInput): Promise<AthleteProfile | null>;
  delete(ownerId: string, id: string): Promise<boolean>;
}

export interface CheckInRepository {
  /** Create or replace the check-in for (owner, profile, date). */
  upsert(ownerId: string, input: CheckInInput): Promise<DailyCheckIn>;
  /** List check-ins for a profile, newest first, optionally limited. */
  listByProfile(ownerId: string, profileId: string, limit?: number): Promise<DailyCheckIn[]>;
  /** Get a single check-in by date (YYYY-MM-DD), or null. */
  getByDate(ownerId: string, profileId: string, date: string): Promise<DailyCheckIn | null>;
  delete(ownerId: string, id: string): Promise<boolean>;
}
