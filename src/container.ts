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
  SqliteRecordRepository,
} from "./data/sqliteRepository.js";
import {
  SupabaseAthleteProfileRepository,
  SupabaseCheckInRepository,
  SupabaseTeamRepository,
  SupabaseRecordRepository,
} from "./data/supabaseRepository.js";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository, TeamRepository } from "./data/repository.js";
import { FamilyService } from "./services/familyService.js";
import { HealthService } from "./services/healthService.js";
import { CalendarService } from "./services/calendarService.js";
import { ProductService } from "./services/productService.js";
import { ReportService } from "./services/reportService.js";
import { IntegrationService } from "./services/integrationService.js";
import { PlateService } from "./services/plateService.js";
import { ResendMailer } from "./services/notifier.js";
import { PlayerService } from "./services/playerService.js";
import { AskService } from "./services/askService.js";
import { ClubService } from "./services/clubService.js";
import { TeamHubService } from "./services/teamHubService.js";
import { BillingService } from "./services/billingService.js";
import { MarketService } from "./services/marketService.js";
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
  family: FamilyService;
  health: HealthService;
  calendar: CalendarService;
  products: ProductService;
  reports: ReportService;
  integrations: IntegrationService;
  plates: PlateService;
  player: PlayerService;
  ask: AskService;
  clubs: ClubService;
  hub: TeamHubService;
  billing: BillingService;
  market: MarketService;
}

function wire(p: AthleteProfileRepository, c: CheckInRepository, t: TeamRepository, r: RecordRepository): Services {
  // Live forecasts unless switched off (WEATHER=off), e.g. for offline development.
  const weather: WeatherProvider | null =
    process.env.WEATHER === "off" ? null
      : process.env.WEATHER === "demo" && process.env.DB_BACKEND !== "supabase" ? new DemoProvider()
        : new NwsProvider();
  const family = new FamilyService(p, r);
  const mailer = new ResendMailer();
  const clubs = new ClubService(p, c, t, r, mailer, weather);
  return {
    profiles: new ProfileService(p),
    checkins: new CheckInService(c, p),
    plans: new PlanService(p, c, weather),
    insights: new InsightService(p, c, weather),
    teams: new TeamService(t, p, c, family, mailer),
    account: new AccountService(p, c, t, r),
    family,
    health: new HealthService(p, c, family, weather),
    calendar: new CalendarService(p, family),
    products: new ProductService(p, family, r),
    reports: new ReportService(p, c, family, r, mailer),
    integrations: new IntegrationService(p, c, family, r),
    plates: new PlateService(p, family, r),
    player: new PlayerService(p, c, family, r),
    ask: new AskService(p, c, family, r, weather),
    clubs, hub: new TeamHubService(p, c, t, r, family, clubs),
    billing: new BillingService(clubs, r),
    market: new MarketService(p, family, r, clubs, mailer),
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
      new SupabaseRecordRepository(url, key),
    );
  }

  // Default: SQLite for local development (lazy-loads better-sqlite3).
  const db = openDatabase(process.env.SQLITE_PATH ?? "data/athlete.db");
  return wire(
    new SqliteAthleteProfileRepository(db),
    new SqliteCheckInRepository(db),
    new SqliteTeamRepository(db),
    new SqliteRecordRepository(db),
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

export const getFamilyService = () => getServices().family;
export const getHealthService = () => getServices().health;
export const getCalendarService = () => getServices().calendar;
export const getProductService = () => getServices().products;
export const getReportService = () => getServices().reports;
export const getIntegrationService = () => getServices().integrations;
export const getPlateService = () => getServices().plates;
export const getPlayerService = () => getServices().player;
export const getAskService = () => getServices().ask;
export const getClubService = () => getServices().clubs;
export const getTeamHubService = () => getServices().hub;
export const getBillingService = () => getServices().billing;
export const getMarketService = () => getServices().market;
