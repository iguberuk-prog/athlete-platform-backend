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
import type {
  AthleteProfileRepository,
  CheckInRepository,
} from "./repository.js";

const PROFILES = "athlete_profiles";
const CHECKINS = "daily_checkins";

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

  async listByOwner(ownerId: string): Promise<AthleteProfile[]> {
    const { data, error } = await this.client
      .from(PROFILES)
      .select("data")
      .eq("owner_id", ownerId)
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
}
