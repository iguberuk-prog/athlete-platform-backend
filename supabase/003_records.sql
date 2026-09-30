-- ============================================================================
-- Migration 003: one small table for links, invites, connected devices,
-- sign-in handshakes and usage limits.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
-- ============================================================================

create table if not exists app_records (
  id          text not null,
  kind        text not null,        -- link, invite, integration, oauth_state, usage, report
  key         text not null,        -- lookup key (profile id, invite code, ...)
  owner_id    text not null,        -- account the record belongs to
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (kind, id)
);
-- If an earlier copy of this file was run (primary key on id only), fix the key.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'app_records_pkey' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') then
    alter table app_records drop constraint app_records_pkey;
    alter table app_records add primary key (kind, id);
  end if;
end $$;

create index if not exists idx_records_kind_key on app_records (kind, key);
create index if not exists idx_records_kind_owner on app_records (kind, owner_id);

-- Same lock-down as the other tables: only the backend can read or write.
alter table app_records enable row level security;
revoke all on app_records from anon, authenticated;

-- Check: rowsecurity should be true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'app_records';
