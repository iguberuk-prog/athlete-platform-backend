/**
 * Supabase (Postgres) implementations of the repository contracts.
 *
 * This is the production data layer. Each domain object is stored whole in a
 * `jsonb` column called `data`, with a few flat columns (id, owner_id, sport,
 * date) for indexing — exactly mirroring the SQLite layout, so behaviour is the
 * same as local development.
 *
 * Owner scoping: every query filters by `owner_id`, so an athlete only ever
 * sees their own rows. The backend runs with the Supabase *service role* key
 * (server-side, trusted), which is correct for a server. When you later add
 * Supabase Auth, switch `owner_id` to the authenticated user id and turn on the
 * Row Level Security policies in supabase_schema.sql for defence in depth.
 *
 * Setup: run supabase_schema.sql in the Supabase SQL editor, then set
 * DB_BACKEND=supabase, SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
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

const PROFILES = "athlete_profiles";
const CHECKINS = "daily_checkins";
const TEAMS = "teams";
const MEMBERS = "team_members";

function makeClient(url: string, serviceKey: string): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY are required for the Supabase backend.",
    );
  }
  // Server-side usage: no session persistence needed. We do not use realtime,
  // but Supabase's client constructs a realtime client that needs a WebSocket;
  // supply one explicitly so it works on any Node version (Netlify functions).
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as never },
  });
}

export class SupabaseAthleteProfileRepository implements AthleteProfileRepository {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = makeClient(url, serviceKey);
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
    const { error } = await this.client.from(PROFILES).insert({
      id: profile.id,
      owner_id: ownerId,
      sport: profile.sport.primarySport,
      data: profile,
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;
    return profile;
  }

  async getById(ownerId: string, id: string): Promise<AthleteProfile | null> {
    const { data, error } = await this.client
      .from(PROFILES)
      .select("data")
      .eq("id", id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.data as AthleteProfile) : null;
  }

  async findById(id: string): Promise<AthleteProfile | null> {
    const { data, error } = await this.client.from(PROFILES).select("data").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? (data.data as AthleteProfile) : null;
  }

  async listByOwner(ownerId: string): Promise<AthleteProfile[]> {
    const { data, error } = await this.client
      .from(PROFILES)
      .select("data")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => r.data as AthleteProfile);
  }

  async listAll(): Promise<AthleteProfile[]> {
    const { data, error } = await this.client
      .from(PROFILES)
      .select("data")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => r.data as AthleteProfile);
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
    const { error } = await this.client
      .from(PROFILES)
      .update({
        sport: updated.sport.primarySport,
        data: updated,
        updated_at: updated.updatedAt,
      })
      .eq("id", id)
      .eq("owner_id", ownerId);
    if (error) throw error;
    return updated;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(PROFILES)
      .delete()
      .eq("id", id)
      .eq("owner_id", ownerId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }
}

export class SupabaseCheckInRepository implements CheckInRepository {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = makeClient(url, serviceKey);
  }

  async upsert(ownerId: string, input: CheckInInput): Promise<DailyCheckIn> {
    const existing = await this.getByDate(ownerId, input.profileId, input.date);
    const checkin: DailyCheckIn = {
      ...input,
      id: existing?.id ?? randomUUID(),
      ownerId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const { error } = await this.client.from(CHECKINS).upsert(
      {
        id: checkin.id,
        owner_id: ownerId,
        profile_id: checkin.profileId,
        date: checkin.date,
        data: checkin,
        created_at: checkin.createdAt,
      },
      { onConflict: "owner_id,profile_id,date" },
    );
    if (error) throw error;
    return checkin;
  }

  async listByProfile(
    ownerId: string,
    profileId: string,
    limit = 30,
  ): Promise<DailyCheckIn[]> {
    const { data, error } = await this.client
      .from(CHECKINS)
      .select("data")
      .eq("owner_id", ownerId)
      .eq("profile_id", profileId)
      .order("date", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => r.data as DailyCheckIn);
  }

  async getByDate(
    ownerId: string,
    profileId: string,
    date: string,
  ): Promise<DailyCheckIn | null> {
    const { data, error } = await this.client
      .from(CHECKINS)
      .select("data")
      .eq("owner_id", ownerId)
      .eq("profile_id", profileId)
      .eq("date", date)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.data as DailyCheckIn) : null;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(CHECKINS)
      .delete()
      .eq("id", id)
      .eq("owner_id", ownerId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async deleteByProfile(ownerId: string, profileId: string): Promise<number> {
    const { data, error } = await this.client
      .from(CHECKINS)
      .delete()
      .eq("owner_id", ownerId)
      .eq("profile_id", profileId)
      .select("id");
    if (error) throw error;
    return data?.length ?? 0;
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

export class SupabaseTeamRepository implements TeamRepository {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = makeClient(url, serviceKey);
  }

  async create(coachOwnerId: string, name: string, code: string): Promise<Team> {
    const team: Team = { id: randomUUID(), name, code, coachOwnerId, createdAt: new Date().toISOString() };
    const { error } = await this.client.from(TEAMS).insert({
      id: team.id, code, name, coach_owner_id: coachOwnerId, created_at: team.createdAt,
    });
    if (error) throw error;
    return team;
  }

  async getById(id: string): Promise<Team | null> {
    const { data, error } = await this.client.from(TEAMS).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toTeam(data as TeamRow) : null;
  }

  async getByCode(code: string): Promise<Team | null> {
    const { data, error } = await this.client.from(TEAMS).select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    return data ? toTeam(data as TeamRow) : null;
  }

  async listByCoach(coachOwnerId: string): Promise<Team[]> {
    const { data, error } = await this.client
      .from(TEAMS)
      .select("*")
      .eq("coach_owner_id", coachOwnerId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => toTeam(r as TeamRow));
  }

  async delete(coachOwnerId: string, id: string): Promise<boolean> {
    // team_members rows go with it (on delete cascade).
    const { data, error } = await this.client
      .from(TEAMS)
      .delete()
      .eq("id", id)
      .eq("coach_owner_id", coachOwnerId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async addMember(m: TeamMember): Promise<TeamMember> {
    const { error } = await this.client.from(MEMBERS).upsert(
      { team_id: m.teamId, profile_id: m.profileId, owner_id: m.ownerId, joined_at: m.joinedAt },
      { onConflict: "team_id,profile_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    const { data, error: e2 } = await this.client
      .from(MEMBERS)
      .select("*")
      .eq("team_id", m.teamId)
      .eq("profile_id", m.profileId)
      .maybeSingle();
    if (e2) throw e2;
    return data ? toMember(data as MemberRow) : m;
  }

  async removeMember(teamId: string, profileId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(MEMBERS)
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", profileId)
      .select("team_id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    const { data, error } = await this.client
      .from(MEMBERS)
      .select("*")
      .eq("team_id", teamId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => toMember(r as MemberRow));
  }

  async listMembershipsForProfile(ownerId: string, profileId: string): Promise<TeamMember[]> {
    const { data, error } = await this.client
      .from(MEMBERS)
      .select("*")
      .eq("owner_id", ownerId)
      .eq("profile_id", profileId);
    if (error) throw error;
    return (data ?? []).map((r) => toMember(r as MemberRow));
  }

  async deleteAllForOwner(ownerId: string): Promise<void> {
    const { error: e1 } = await this.client.from(TEAMS).delete().eq("coach_owner_id", ownerId);
    if (e1) throw e1;
    const { error: e2 } = await this.client.from(MEMBERS).delete().eq("owner_id", ownerId);
    if (e2) throw e2;
  }
}

const RECORDS = "app_records";
interface SbRecordRow { id: string; kind: string; key: string; owner_id: string; data: unknown; created_at: string; updated_at: string }
const sbRecord = <T>(r: SbRecordRow): AppRecord<T> => ({ id: r.id, kind: r.kind, key: r.key, ownerId: r.owner_id, data: r.data as T, createdAt: r.created_at, updatedAt: r.updated_at });

export class SupabaseRecordRepository implements RecordRepository {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.client = makeClient(url, serviceKey);
  }
  async put<T>(rec: Omit<AppRecord<T>, "createdAt" | "updatedAt"> & { createdAt?: string }): Promise<AppRecord<T>> {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = { id: rec.id, kind: rec.kind, key: rec.key, owner_id: rec.ownerId, data: rec.data, updated_at: now };
    if (rec.createdAt) row.created_at = rec.createdAt;
    const { data, error } = await this.client.from(RECORDS).upsert(row, { onConflict: "kind,id" }).select("*").single();
    if (error) throw error;
    return sbRecord<T>(data as SbRecordRow);
  }
  async get<T>(kind: string, id: string) {
    const { data, error } = await this.client.from(RECORDS).select("*").eq("kind", kind).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? sbRecord<T>(data as SbRecordRow) : null;
  }
  async listByKey<T>(kind: string, key: string) {
    const { data, error } = await this.client.from(RECORDS).select("*").eq("kind", kind).eq("key", key).order("created_at");
    if (error) throw error;
    return (data as SbRecordRow[]).map((r) => sbRecord<T>(r));
  }
  async listByOwner<T>(kind: string, ownerId: string) {
    const { data, error } = await this.client.from(RECORDS).select("*").eq("kind", kind).eq("owner_id", ownerId).order("created_at");
    if (error) throw error;
    return (data as SbRecordRow[]).map((r) => sbRecord<T>(r));
  }
  async listByKind<T>(kind: string, limit = 1000) {
    const { data, error } = await this.client.from(RECORDS).select("*").eq("kind", kind).order("created_at").limit(limit);
    if (error) throw error;
    return (data as SbRecordRow[]).map((r) => sbRecord<T>(r));
  }
  async delete(kind: string, id: string) {
    const { data, error } = await this.client.from(RECORDS).delete().eq("kind", kind).eq("id", id).select("id");
    if (error) throw error;
    return (data || []).length > 0;
  }
  async deleteByOwner(ownerId: string) {
    const { error } = await this.client.from(RECORDS).delete().eq("owner_id", ownerId);
    if (error) throw error;
  }
  async deleteByKey(kind: string, key: string) {
    const { error } = await this.client.from(RECORDS).delete().eq("kind", kind).eq("key", key);
    if (error) throw error;
  }
}
