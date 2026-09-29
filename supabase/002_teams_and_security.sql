-- ============================================================================
-- Migration 002: coach teams + lock down direct database access
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
-- ============================================================================

-- 1) Coach teams ------------------------------------------------------------
create table if not exists teams (
  id              uuid primary key,
  code            text not null unique,        -- join code players enter
  name            text not null,
  coach_owner_id  text not null,               -- account that coaches the team
  created_at      timestamptz not null default now()
);
create index if not exists idx_teams_coach on teams (coach_owner_id);

create table if not exists team_members (
  team_id     uuid not null references teams (id) on delete cascade,
  profile_id  uuid not null references athlete_profiles (id) on delete cascade,
  owner_id    text not null,                   -- account that owns the profile
  joined_at   timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index if not exists idx_members_profile on team_members (owner_id, profile_id);

-- 2) Row Level Security -----------------------------------------------------
-- The public "anon" key is visible in every browser. Without RLS, anyone who
-- has it can read these tables straight through Supabase's REST API.
--
-- All app traffic goes through our Netlify functions, which use the secret
-- service-role key (it bypasses RLS) and check the login on every request.
-- So we switch RLS ON and add NO public policies: the browser keys can read
-- and write nothing directly. Only the backend can.
alter table athlete_profiles enable row level security;
alter table daily_checkins   enable row level security;
alter table teams            enable row level security;
alter table team_members     enable row level security;

-- Belt and braces: strip any table privileges the public roles may have.
revoke all on athlete_profiles, daily_checkins, teams, team_members from anon, authenticated;

-- 3) Check it worked ---------------------------------------------------------
-- Every row below should show rowsecurity = true.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('athlete_profiles', 'daily_checkins', 'teams', 'team_members');
