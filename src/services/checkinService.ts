/**
 * Check-in service — validates and stores daily check-ins.
 *
 * Mirrors ProfileService: validate first, then persist via the repository, and
 * return a typed result the HTTP layer maps to status codes. Knows nothing about
 * HTTP or which database is in use.
 */

import type { CheckInInput, DailyCheckIn } from "../domain/checkin.js";
import {
  validateCheckInInput,
  type ValidationError,
} from "../domain/validation.js";
import type {
  AthleteProfileRepository,
  CheckInRepository,
} from "../data/repository.js";

export type CheckInResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "validation"; errors: ValidationError[] }
  | { ok: false; code: "not_found" };

export class CheckInService {
  constructor(
    private readonly checkins: CheckInRepository,
    private readonly profiles: AthleteProfileRepository,
  ) {}

  /** Log (or overwrite) the check-in for a given day. */
  async log(
    ownerId: string,
    input: CheckInInput,
  ): Promise<CheckInResult<DailyCheckIn>> {
    const result = validateCheckInInput(input);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    // The profile must exist and be owned by this caller.
    const profile = await this.profiles.getById(ownerId, input.profileId);
    if (!profile) return { ok: false, code: "not_found" };

    const value = await this.checkins.upsert(ownerId, input);
    return { ok: true, value };
  }

  async list(
    ownerId: string,
    profileId: string,
    limit?: number,
  ): Promise<DailyCheckIn[]> {
    return this.checkins.listByProfile(ownerId, profileId, limit);
  }

  async delete(ownerId: string, id: string): Promise<CheckInResult<true>> {
    const removed = await this.checkins.delete(ownerId, id);
    return removed ? { ok: true, value: true } : { ok: false, code: "not_found" };
  }
}
