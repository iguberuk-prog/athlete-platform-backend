/**
 * SQLite implementations of the repository contracts (local development).
 *
 * Both repositories take a shared DB connection (see db.ts), so the profile and
 * its check-ins live in one file. The full domain object is stored as JSON in a
 * `data` column, which maps 1:1 onto Postgres `jsonb` for the Supabase move.
 *
 * Note: on Netlify the function filesystem is ephemeral, so SQLite is for local
 * dev only; production persistence is Supabase (see supabaseRepository.ts).
 */

import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import type { CheckInInput, DailyCheckIn } from "../domain/checkin.js";
import type {
  AthleteProfileRepository,
  CheckInRepository,
} from "./repository.js";

interface ProfileRow {
  id: string;
  owner_id: string;
  sport: string;
  data: string;
  created_at: string;
  updated_at: string;
}

interface CheckInRow {
  id: string;
  owner_id: string;
  profile_id: string;
  date: string;
  data: string;
  created_at: string;
}

export class SqliteAthleteProfileRepository implements AthleteProfileRepository {
  constructor(private readonly db: DB) {}

  private toProfile(row: ProfileRow): AthleteProfile {
    return JSON.parse(row.data) as AthleteProfile;
  }

  async create(ownerId: string, input: ProfileInput): Promise<AthleteProfile> {
    const now = new Date().toISOString();
    const profile: AthleteProfile = {
      ...input,
      id: randomUUID(),
      ownerId,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO athlete_profiles (id, owner_id, sport, data, created_at, updated_at)
         VALUES (@id, @owner_id, @sport, @data, @created_at, @updated_at)`,
      )
      .run({
        id: profile.id,
        owner_id: ownerId,
        sport: profile.sport.primarySport,
        data: JSON.stringify(profile),
        created_at: now,
        updated_at: now,
      });
    return profile;
  }

  async getById(ownerId: string, id: string): Promise<AthleteProfile | null> {
    const row = this.db
      .prepare(`SELECT * FROM athlete_profiles WHERE id = ? AND owner_id = ?`)
      .get(id, ownerId) as ProfileRow | undefined;
    return row ? this.toProfile(row) : null;
  }

  async listByOwner(ownerId: string): Promise<AthleteProfile[]> {
    const rows = this.db
      .prepare(`SELECT * FROM athlete_profiles WHERE owner_id = ? ORDER BY created_at`)
      .all(ownerId) as ProfileRow[];
    return rows.map((r) => this.toProfile(r));
  }

  async update(
    ownerId: string,
    id: string,
    input: ProfileInput,
  ): Promise<AthleteProfile | null> {
    const existing = await this.getById(ownerId, id);
    if (!existing) return null;
    const updated: AthleteProfile = {
      ...input,
      id: existing.id,
      ownerId: existing.ownerId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE athlete_profiles
            SET sport = @sport, data = @data, updated_at = @updated_at
          WHERE id = @id AND owner_id = @owner_id`,
      )
      .run({
        id: updated.id,
        owner_id: ownerId,
        sport: updated.sport.primarySport,
        data: JSON.stringify(updated),
        updated_at: updated.updatedAt,
      });
    return updated;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const info = this.db
      .prepare(`DELETE FROM athlete_profiles WHERE id = ? AND owner_id = ?`)
      .run(id, ownerId);
    return info.changes > 0;
  }
}

export class SqliteCheckInRepository implements CheckInRepository {
  constructor(private readonly db: DB) {}

  private toCheckIn(row: CheckInRow): DailyCheckIn {
    return JSON.parse(row.data) as DailyCheckIn;
  }

  async upsert(ownerId: string, input: CheckInInput): Promise<DailyCheckIn> {
    const existing = await this.getByDate(ownerId, input.profileId, input.date);
    const checkin: DailyCheckIn = {
      ...input,
      id: existing?.id ?? randomUUID(),
      ownerId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO daily_checkins (id, owner_id, profile_id, date, data, created_at)
         VALUES (@id, @owner_id, @profile_id, @date, @data, @created_at)
         ON CONFLICT (owner_id, profile_id, date)
         DO UPDATE SET data = excluded.data`,
      )
      .run({
        id: checkin.id,
        owner_id: ownerId,
        profile_id: checkin.profileId,
        date: checkin.date,
        data: JSON.stringify(checkin),
        created_at: checkin.createdAt,
      });
    return checkin;
  }

  async listByProfile(
    ownerId: string,
    profileId: string,
    limit = 30,
  ): Promise<DailyCheckIn[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM daily_checkins
          WHERE owner_id = ? AND profile_id = ?
          ORDER BY date DESC
          LIMIT ?`,
      )
      .all(ownerId, profileId, limit) as CheckInRow[];
    return rows.map((r) => this.toCheckIn(r));
  }

  async getByDate(
    ownerId: string,
    profileId: string,
    date: string,
  ): Promise<DailyCheckIn | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM daily_checkins
          WHERE owner_id = ? AND profile_id = ? AND date = ?`,
      )
      .get(ownerId, profileId, date) as CheckInRow | undefined;
    return row ? this.toCheckIn(row) : null;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const info = this.db
      .prepare(`DELETE FROM daily_checkins WHERE id = ? AND owner_id = ?`)
      .run(id, ownerId);
    return info.changes > 0;
  }
}
