/**
 * SQLite connection + schema for local development.
 *
 * better-sqlite3 is a NATIVE module needed only for local dev. It is loaded
 * lazily (via createRequire) inside openDatabase(), so simply importing this
 * file does not pull in the native binary. On Netlify (Supabase backend),
 * openDatabase() is never called, so better-sqlite3 is never loaded.
 */

import { createRequire } from "node:module";
import type DatabaseType from "better-sqlite3";

export type DB = DatabaseType.Database;

export function openDatabase(filename = ":memory:"): DB {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3") as typeof DatabaseType;
  const db: DB = new Database(filename);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS athlete_profiles (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      sport       TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_owner
      ON athlete_profiles (owner_id);

    CREATE TABLE IF NOT EXISTS daily_checkins (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      profile_id  TEXT NOT NULL,
      date        TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_profile
      ON daily_checkins (owner_id, profile_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_checkin_per_day
      ON daily_checkins (owner_id, profile_id, date);

    CREATE TABLE IF NOT EXISTS teams (
      id              TEXT PRIMARY KEY,
      code            TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      coach_owner_id  TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_teams_coach ON teams (coach_owner_id);

    CREATE TABLE IF NOT EXISTS team_members (
      team_id     TEXT NOT NULL,
      profile_id  TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      joined_at   TEXT NOT NULL,
      PRIMARY KEY (team_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_members_profile ON team_members (owner_id, profile_id);
  `);
}
