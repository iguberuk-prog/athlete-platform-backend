# Athlete Performance Platform

Personal game-day fueling, recovery and readiness for athletes, parents and coaches.

- **Web app / PWA**: `public/` (mobile-first, installable, works offline)
- **API**: `netlify/functions/` on Netlify, data in Supabase
- **iPhone app**: `mobile/` (Expo shell: local notifications + Apple Health)
- **Launch steps**: `docs/LAUNCH_CHECKLIST.md` · **Store copy**: `docs/APP_STORE_LISTING.md`

## What the app does

| Screen | What it gives the athlete |
|---|---|
| Today | Day type (game, game tomorrow, recovery, practice, rest), readiness score, carb/protein/fluid targets scaled to body weight, focus list, next reminders |
| Game Day | Hour-by-hour plan (list or calendar), night-before prep, early-kickoff handling, .ics / Google Calendar export |
| Recovery | Multi-day plan after a game; links games 2 days apart into a tournament with fast-refuel windows |
| Check-in | 30-second sleep/energy/soreness/stress/hydration + training minutes and effort; Apple Health fill on iPhone |
| Trends | 28-day readiness and sleep, weekly training load with acute:chronic spike warning |
| Grocery | 7-day allergy-safe shopping list from the schedule |
| Team | Coaches create teams with a join code and see a limited roster; players join or leave |
| Reminders | Fuel, hydration, recovery, check-in and wind-down nudges from the athlete's schedule |
| Account | Password reset/change, data export, full account deletion |

Accounts are **athlete** (13+), **parent** (manages several kids, required under 13) or **coach**.

## New API endpoints

| Method + path | Purpose |
|---|---|
| `GET /api/profiles/:id/today?date=&now=` | Today summary + today's reminders |
| `GET /api/profiles/:id/recovery?date=&match=` | Multi-day / tournament recovery plan |
| `GET /api/profiles/:id/trends?date=&days=28` | Trend series + load ratio |
| `GET /api/profiles/:id/grocery?from=&days=7` | Grocery list |
| `GET /api/profiles/:id/reminders?from=&days=7&now=&off=` | Reminder schedule (the iPhone app turns these into notifications) |
| `DELETE /api/profiles/:id/events?startTime=&type=&series=` | Remove a game/practice, or a weekly series |
| `GET/POST /api/profiles/:id/teams`, `DELETE .../teams/:teamId` | Join / leave a team |
| `GET/POST /api/teams`, `GET /api/teams/:id/roster`, `DELETE /api/teams/:id[/members/:profileId]` | Coach teams |
| `GET/DELETE /api/account` | Who am I / delete everything |

Engines are pure functions in `src/domain/` (`daily.ts`, `recovery.ts`, `trends.ts`, `grocery.ts`, `reminders.ts`, `readiness.ts`) with tests in `scripts/test.ts` (116 checks).

---

## Original backend notes

## Tech choices

- **Runtime/host:** Node + TypeScript, deployed as **Netlify Functions** (v2).
- **Storage now:** **SQLite** (one local file) for fast local development.
- **Storage later:** **Supabase** (Postgres). The data layer is behind an
  interface, so switching is a config change (`DB_BACKEND`). See SETUP_GUIDE /
  INTEGRATION_GUIDE.

## Profile fields (deduplicated, grouped)

Repeated fields from the original list were merged (Age vs Date of Birth;
Allergies/Restrictions; Height/Weight; Injury History; Medications; Primary
sport/Position/Level). A small required core is enforced; everything else is
optional and validated only if present.

| Group | Fields |
|-------|--------|
| **identity** | fullName*, dateOfBirth (or age)*, sex*, hometown, graduationYear, school, clubTeam, jerseyNumber |
| **contact** | athleteEmail, parentEmail, athletePhone, parentPhone, emergencyContact |
| **sport** | primarySport*, secondarySports, positions*, competitionLevel*, yearsPlaying, dominantFoot, seasonStatus |
| **anthropometrics** | heightCm*, bodyMassKg*, bodyFatPct |
| **training** | trainingDaysPerWeek, avgSessionMinutes, intensity, matchesPerWeek, strengthSessionsPerWeek |
| **nutrition** | allergies*, dietaryRestrictions*, intolerances*, preferredDiet, dislikes*, mealsPerDay, mealPattern, waterIntakeLitres, caffeineMgPerDay, supplements |
| **recovery** | avgSleepHours, sleepQuality (1-10), napFrequency, recoveryMethods, baselineSoreness, baselineEnergy |
| **health** | injuryHistory, currentInjuries, medicalConditions, medications, recentIllnessStatus, fitnessNotes |
| **goals** | goals (multi-select), seasonGoals |
| **advanced** | restingHeartRate, hrvMs, wearables, sweatRateLitresPerHour, estimatedCalorieExpenditure, menstrualCycleTracking |
| **schedule** | events (match/training/recovery/travel/tournament), travelDays, tournamentWeekends |

`*` = required core. Allowed values for every enum-like field live in
`src/domain/enums.ts`.

## Daily check-in (logged repeatedly, not once)

One row per athlete per day: `date`* plus optional `sleepHoursLastNight`,
`energyLevel`, `stressLevel`, `hydrationLevel`, `sorenessLevel` (1-10), `mood`,
`trainingPlanned`, `trainingCompleted`, and optional `restingHeartRate` / `hrvMs`.
Logging the same date again updates that day's entry.

## Project layout

```
backend/
├─ src/
│  ├─ domain/
│  │  ├─ enums.ts          Controlled vocabularies + numeric bounds
│  │  ├─ profile.ts        Grouped AthleteProfile type + effectiveAge()
│  │  ├─ checkin.ts        DailyCheckIn type
│  │  └─ validation.ts     Safety validation for profiles + check-ins
│  ├─ data/
│  │  ├─ db.ts             SQLite connection + schema (both tables)
│  │  ├─ repository.ts     Data-access interfaces (owner-scoped)
│  │  ├─ sqliteRepository.ts    SQLite implementations (local dev)
│  │  └─ supabaseRepository.ts  Supabase implementations (stub + SQL)
│  ├─ services/
│  │  ├─ profileService.ts Validate, then persist profiles
│  │  └─ checkinService.ts Validate + ensure profile ownership, then persist
│  └─ container.ts         Picks the DB backend, builds the services
├─ netlify/functions/
│  ├─ profiles.ts          /api/profiles CRUD
│  └─ checkins.ts          /api/profiles/:profileId/checkins
├─ scripts/
│  ├─ demo.ts              Create a profile + log a check-in, print both
│  └─ test.ts              27-check end-to-end test (no framework)
├─ netlify.toml
├─ tsconfig.json
└─ package.json
```

## Getting started

```bash
cd backend
npm install
npm run typecheck   # type-check the whole project
npm test            # 27 end-to-end checks against in-memory SQLite
npm run demo        # create a sample profile + check-in and print them
```

To run the HTTP API locally: `npm install -g netlify-cli` then `npm run dev`
(serves at http://localhost:8888).

## HTTP API

Identity is supplied via the **`x-owner-id`** header (stand-in for real auth).

Profiles:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/profiles` | Create a profile (201) |
| GET | `/api/profiles` | List the caller's profiles |
| GET | `/api/profiles/:id` | Get one profile |
| PUT | `/api/profiles/:id` | Replace one profile |
| DELETE | `/api/profiles/:id` | Delete one profile (204) |

Check-ins:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/profiles/:profileId/checkins` | Log/overwrite today's check-in (201) |
| GET | `/api/profiles/:profileId/checkins?limit=N` | List recent check-ins |
| DELETE | `/api/profiles/:profileId/checkins/:id` | Delete a check-in (204) |

Errors: `401` missing owner header, `404` not found / not owned, `422`
validation failed (body lists each error with a field `path`).

## Safety & privacy

- Allergies and dietary restrictions are stored as structured, validated data
  (hard constraints), so the future food filter can rely on them. An `"other"`
  allergen must include a note.
- Plausibility checks catch unit mistakes (e.g. body mass 750 kg) and 1-10
  scales out of range, before they reach the recommendation logic.
- Owner-only access on every operation; in Supabase this is enforced again by
  Row Level Security.
- Minimal sensitive data by default; medical fields are optional and free-text.

See **INTEGRATION_GUIDE.md** for step-by-step instructions to use this in your
app and to migrate to Supabase.
