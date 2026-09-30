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
  SqliteTeamRepository,
} from "./data/sqliteRepository.js";
import {
  SupabaseAthleteProfileRepository,
  SupabaseCheckInRepository,
  SupabaseTeamRepository,
} from "./data/supabaseRepository.js";
import type { AthleteProfileRepository, CheckInRepository, TeamRepository } from "./data/repository.js";
import { ProfileService } from "./services/profileService.js";
import { CheckInService } from "./services/checkinService.js";
import { PlanService } from "./services/planService.js";
import { InsightService } from "./services/insightService.js";
import { TeamService } from "./services/teamService.js";
import { AccountService } from "./services/accountService.js";
import { DemoProvider, NwsProvider, type WeatherProvider } from "./weather/nws.js";

interface Services {
  profiles: ProfileService;
  checkins: CheckInService;
  plans: PlanService;
  insights: InsightService;
  teams: TeamService;
  account: AccountService;
}

function wire(p: AthleteProfileRepository, c: CheckInRepository, t: TeamRepository): Services {
  // Live forecasts unless switched off (WEATHER=off), e.g. for offline development.
  const weather: WeatherProvider | null =
    process.env.WEATHER === "off" ? null
      : process.env.WEATHER === "demo" && process.env.DB_BACKEND !== "supabase" ? new DemoProvider()
        : new NwsProvider();
  return {
    profiles: new ProfileService(p),
    checkins: new CheckInService(c, p),
    plans: new PlanService(p, c, weather),
    insights: new InsightService(p, c, weather),
    teams: new TeamService(t, p, c),
    account: new AccountService(p, c, t),
  };
}

let services: Services | null = null;

function build(): Services {
  const backend = process.env.DB_BACKEND ?? "sqlite";

  if (backend === "supabase") {
    const url = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_KEY ?? "";
    return wire(
      new SupabaseAthleteProfileRepository(url, key),
      new SupabaseCheckInRepository(url, key),
      new SupabaseTeamRepository(url, key),
    );
  }

  // Default: SQLite for local development (lazy-loads better-sqlite3).
  const db = openDatabase(process.env.SQLITE_PATH ?? "data/athlete.db");
  return wire(
    new SqliteAthleteProfileRepository(db),
    new SqliteCheckInRepository(db),
    new SqliteTeamRepository(db),
  );
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

export function getPlanService(): PlanService {
  return getServices().plans;
}

export function getInsightService(): InsightService {
  return getServices().insights;
}

export function getTeamService(): TeamService {
  return getServices().teams;
}

export function getAccountService(): AccountService {
  return getServices().account;
}
