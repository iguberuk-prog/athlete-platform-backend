/**
 * Composition root: builds the repositories and services. The single place that
 * knows about concrete databases — everything else depends only on interfaces.
 *
 * All imports are static (the bundler resolves them at build time). SQLite's
 * native module is loaded lazily inside openDatabase(), so the Supabase
 * production path never touches better-sqlite3.
 *
 * Switch with the DB_BACKEND env var:
 *   DB_BACKEND=sqlite   (default) — local development
 *   DB_BACKEND=supabase           — production (set SUPABASE_URL/SERVICE_KEY)
 */

import { openDatabase } from "./data/db.js";
import {
  SqliteAthleteProfileRepository,
  SqliteCheckInRepository,
} from "./data/sqliteRepository.js";
import {
  SupabaseAthleteProfileRepository,
  SupabaseCheckInRepository,
} from "./data/supabaseRepository.js";
import { ProfileService } from "./services/profileService.js";
import { CheckInService } from "./services/checkinService.js";

interface Services {
  profiles: ProfileService;
  checkins: CheckInService;
}

let services: Services | null = null;

function build(): Services {
  const backend = process.env.DB_BACKEND ?? "sqlite";

  if (backend === "supabase") {
    const url = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_KEY ?? "";
    const profilesRepo = new SupabaseAthleteProfileRepository(url, key);
    const checkinsRepo = new SupabaseCheckInRepository(url, key);
    return {
      profiles: new ProfileService(profilesRepo),
      checkins: new CheckInService(checkinsRepo, profilesRepo),
    };
  }

  // Default: SQLite for local development (lazy-loads better-sqlite3).
  const db = openDatabase(process.env.SQLITE_PATH ?? "data/athlete.db");
  const profilesRepo = new SqliteAthleteProfileRepository(db);
  const checkinsRepo = new SqliteCheckInRepository(db);
  return {
    profiles: new ProfileService(profilesRepo),
    checkins: new CheckInService(checkinsRepo, profilesRepo),
  };
}

function getServices(): Services {
  if (!services) services = build();
  return services;
}

export function getProfileService(): ProfileService {
  return getServices().profiles;
}

export function getCheckInService(): CheckInService {
  return getServices().checkins;
}
