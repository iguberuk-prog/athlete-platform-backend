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
import type { Team, TeamMember } from "../domain/team.js";
import type {
  AthleteProfileRepository,
  CheckInRepository,
  TeamRepository,
  AppRecord,
  RecordRepository,
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

  async findById(id: string): Promise<AthleteProfile | null> {
    const row = this.db.prepare(`SELECT * FROM athlete_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
    return row ? this.toProfile(row) : null;
  }

  async listByOwner(ownerId: string): Promise<AthleteProfile[]> {
    const rows = this.db
      .prepare(`SELECT * FROM athlete_profiles WHERE owner_id = ? ORDER BY created_at`)
      .all(ownerId) as ProfileRow[];
    return rows.map((r) => this.toProfile(r));
  }

  async listAll(): Promise<AthleteProfile[]> {
    const rows = this.db
      .prepare(`SELECT * FROM athlete_profiles ORDER BY created_at`)
      .all() as ProfileRow[];
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
    if (info.changes > 0) {
      // Mirror the Supabase on-delete cascades.
      this.db.prepare(`DELETE FROM daily_checkins WHERE owner_id = ? AND profile_id = ?`).run(ownerId, id);
      this.db.prepare(`DELETE FROM team_members WHERE profile_id = ?`).run(id);
    }
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

  async deleteByProfile(ownerId: string, profileId: string): Promise<number> {
    const info = this.db
      .prepare(`DELETE FROM daily_checkins WHERE owner_id = ? AND profile_id = ?`)
      .run(ownerId, profileId);
    return info.changes;
  }
}

interface TeamRow {
  id: string;
  code: string;
  name: string;
  coach_owner_id: string;
  created_at: string;
}
interface MemberRow {
  team_id: string;
  profile_id: string;
  owner_id: string;
  joined_at: string;
}
const toTeam = (r: TeamRow): Team => ({
  id: r.id, code: r.code, name: r.name, coachOwnerId: r.coach_owner_id, createdAt: r.created_at,
});
const toMember = (r: MemberRow): TeamMember => ({
  teamId: r.team_id, profileId: r.profile_id, ownerId: r.owner_id, joinedAt: r.joined_at,
});

export class SqliteTeamRepository implements TeamRepository {
  constructor(private readonly db: DB) {}

  async create(coachOwnerId: string, name: string, code: string): Promise<Team> {
    const team: Team = { id: randomUUID(), name, code, coachOwnerId, createdAt: new Date().toISOString() };
    this.db
      .prepare(`INSERT INTO teams (id, code, name, coach_owner_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(team.id, team.code, team.name, team.coachOwnerId, team.createdAt);
    return team;
  }

  async getById(id: string): Promise<Team | null> {
    const row = this.db.prepare(`SELECT * FROM teams WHERE id = ?`).get(id) as TeamRow | undefined;
    return row ? toTeam(row) : null;
  }

  async getByCode(code: string): Promise<Team | null> {
    const row = this.db.prepare(`SELECT * FROM teams WHERE code = ?`).get(code) as TeamRow | undefined;
    return row ? toTeam(row) : null;
  }

  async listByCoach(coachOwnerId: string): Promise<Team[]> {
    const rows = this.db
      .prepare(`SELECT * FROM teams WHERE coach_owner_id = ? ORDER BY created_at`)
      .all(coachOwnerId) as TeamRow[];
    return rows.map(toTeam);
  }

  async delete(coachOwnerId: string, id: string): Promise<boolean> {
    const info = this.db.prepare(`DELETE FROM teams WHERE id = ? AND coach_owner_id = ?`).run(id, coachOwnerId);
    if (info.changes > 0) this.db.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(id);
    return info.changes > 0;
  }

  async addMember(m: TeamMember): Promise<TeamMember> {
    this.db
      .prepare(
        `INSERT INTO team_members (team_id, profile_id, owner_id, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (team_id, profile_id) DO NOTHING`,
      )
      .run(m.teamId, m.profileId, m.ownerId, m.joinedAt);
    const row = this.db
      .prepare(`SELECT * FROM team_members WHERE team_id = ? AND profile_id = ?`)
      .get(m.teamId, m.profileId) as MemberRow;
    return toMember(row);
  }

  async removeMember(teamId: string, profileId: string): Promise<boolean> {
    const info = this.db
      .prepare(`DELETE FROM team_members WHERE team_id = ? AND profile_id = ?`)
      .run(teamId, profileId);
    return info.changes > 0;
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const rows = this.db
      .prepare(`SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at`)
      .all(teamId) as MemberRow[];
    return rows.map(toMember);
  }

  async listMembershipsForProfile(ownerId: string, profileId: string): Promise<TeamMember[]> {
    const rows = this.db
      .prepare(`SELECT * FROM team_members WHERE owner_id = ? AND profile_id = ?`)
      .all(ownerId, profileId) as MemberRow[];
    return rows.map(toMember);
  }

  async deleteAllForOwner(ownerId: string): Promise<void> {
    const teams = await this.listByCoach(ownerId);
    for (const t of teams) await this.delete(ownerId, t.id);
    this.db.prepare(`DELETE FROM team_members WHERE owner_id = ?`).run(ownerId);
  }
}

interface RecordRow { id: string; kind: string; key: string; owner_id: string; data: string; created_at: string; updated_at: string }
const toRecord = <T>(r: RecordRow): AppRecord<T> => ({ id: r.id, kind: r.kind, key: r.key, ownerId: r.owner_id, data: JSON.parse(r.data) as T, createdAt: r.created_at, updatedAt: r.updated_at });

export class SqliteRecordRepository implements RecordRepository {
  constructor(private readonly db: DB) {}
  async put<T>(rec: Omit<AppRecord<T>, "createdAt" | "updatedAt"> & { createdAt?: string }): Promise<AppRecord<T>> {
    const now = new Date().toISOString();
    const prev = this.db.prepare(`SELECT created_at FROM app_records WHERE id = ?`).get(rec.id) as { created_at: string } | undefined;
    const createdAt = prev?.created_at || rec.createdAt || now;
    this.db.prepare(`INSERT OR REPLACE INTO app_records (id, kind, key, owner_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(rec.id, rec.kind, rec.key, rec.ownerId, JSON.stringify(rec.data), createdAt, now);
    return { ...rec, createdAt, updatedAt: now };
  }
  async get<T>(kind: string, id: string) {
    const r = this.db.prepare(`SELECT * FROM app_records WHERE kind = ? AND id = ?`).get(kind, id) as RecordRow | undefined;
    return r ? toRecord<T>(r) : null;
  }
  async listByKey<T>(kind: string, key: string) {
    return (this.db.prepare(`SELECT * FROM app_records WHERE kind = ? AND key = ? ORDER BY created_at`).all(kind, key) as RecordRow[]).map((r) => toRecord<T>(r));
  }
  async listByOwner<T>(kind: string, ownerId: string) {
    return (this.db.prepare(`SELECT * FROM app_records WHERE kind = ? AND owner_id = ? ORDER BY created_at`).all(kind, ownerId) as RecordRow[]).map((r) => toRecord<T>(r));
  }
  async listByKind<T>(kind: string, limit = 1000) {
    return (this.db.prepare(`SELECT * FROM app_records WHERE kind = ? ORDER BY created_at LIMIT ?`).all(kind, limit) as RecordRow[]).map((r) => toRecord<T>(r));
  }
  async delete(kind: string, id: string) {
    return this.db.prepare(`DELETE FROM app_records WHERE kind = ? AND id = ?`).run(kind, id).changes > 0;
  }
  async deleteByOwner(ownerId: string) {
    this.db.prepare(`DELETE FROM app_records WHERE owner_id = ?`).run(ownerId);
  }
  async deleteByKey(kind: string, key: string) {
    this.db.prepare(`DELETE FROM app_records WHERE kind = ? AND key = ?`).run(kind, key);
  }
}
