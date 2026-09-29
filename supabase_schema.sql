-- ============================================================================
-- Athlete Performance Platform — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query)
-- ============================================================================

-- Profiles: one row per athlete profile. The full profile object is stored in
-- `data` (jsonb); a few flat columns exist for indexing.
create table if not exists athlete_profiles (
  id          uuid primary key,
  owner_id    text not null,          -- the athlete who owns this profile
  sport       text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_profiles_owner on athlete_profiles (owner_id);

-- Daily check-ins: one row per athlete per day.
create table if not exists daily_checkins (
  id          uuid primary key,
  owner_id    text not null,
  profile_id  uuid not null references athlete_profiles (id) on delete cascade,
  date        date not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, profile_id, date)
);
create index if not exists idx_checkins_profile
  on daily_checkins (owner_id, profile_id, date);

-- Teams, membership and Row Level Security live in
-- supabase/002_teams_and_security.sql. Run that file after this one.
