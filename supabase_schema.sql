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

-- ============================================================================
-- NOTE ON SECURITY (read before going live with real users)
-- ----------------------------------------------------------------------------
-- The backend connects with the Supabase SERVICE ROLE key (server-side, trusted)
-- and scopes every query by owner_id, so data is already private per owner.
--
-- When you add Supabase Auth (real logins), do two things:
--   1) Set owner_id from the authenticated user (auth.uid()) instead of the
--      x-owner-id header (change getOwnerId() in the Netlify functions).
--   2) Enable the Row Level Security policies below for defence in depth.
--
-- To enable later, change owner_id columns to `uuid` referencing auth.users and
-- run:
--
--   alter table athlete_profiles enable row level security;
--   alter table daily_checkins   enable row level security;
--   create policy "owner rw profiles" on athlete_profiles
--     for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
--   create policy "owner rw checkins" on daily_checkins
--     for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
-- ============================================================================
