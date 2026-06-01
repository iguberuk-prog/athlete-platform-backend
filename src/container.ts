/**
 * Composition root: builds the repositories and services. The single place that
 * knows about concrete databases — everything else depends only on interfaces.
 *
 * Backends are loaded LAZILY via dynamic import, so:
 *   - on Netlify with DB_BACKEND=supabase, the native SQLite module is never
 *     loaded (it only works locally);
 *   - locally with the default sqlite backend, the Supabase client is never
 *     loaded.
 *
 * Switch with the DB_BACKEND env var:
 *   DB_BACKEND=sqlite   (default) — local development
 *   DB_BACKEND=supabase           — production (set SUPABASE_URL/SERVICE_KEY)
 */

import { ProfileService } from "./services/profileService.js";
import { CheckInService } from "./services/checkinService.js";

interface Services {
  profiles: ProfileService;
  checkins: CheckInService;
}

let servicesPromise: Promise<Services> | null = null;

async function build(): Promise<Services> {
  const backend = process.env.DB_BACKEND ?? "sqlite";

  if (backend === "supabase") {
    const { SupabaseAthleteProfileRepository, SupabaseCheckInRepository } =
      await import("./data/supabaseRepository.js");
    const url = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_KEY ?? "";
    const profilesRepo = new SupabaseAthleteProfileRepository(url, key);
    const checkinsRepo = new SupabaseCheckInRepository(url, key);
    return {
      profiles: new ProfileService(profilesRepo),
      checkins: new CheckInService(checkinsRepo, profilesRepo),
    };
  }

  // Default: SQLite for local development.
  const { openDatabase } = await import("./data/db.js");
  const { SqliteAthleteProfileRepository, SqliteCheckInRepository } =
    await import("./data/sqliteRepository.js");
  const db = openDatabase(process.env.SQLITE_PATH ?? "data/athlete.db");
  const profilesRepo = new SqliteAthleteProfileRepository(db);
  const checkinsRepo = new SqliteCheckInRepository(db);
  return {
    profiles: new ProfileService(profilesRepo),
    checkins: new CheckInService(checkinsRepo, profilesRepo),
  };
}

function getServices(): Promise<Services> {
  if (!servicesPromise) servicesPromise = build();
  return servicesPromise;
}

export async function getProfileService(): Promise<ProfileService> {
  return (await getServices()).profiles;
}

export async function getCheckInService(): Promise<CheckInService> {
  return (await getServices()).checkins;
}
