# Step-by-Step: Adding the Athlete Profile + Check-ins to Your Program

This guide takes you from the code on disk to a running API your app can call,
then to production on Netlify + Supabase. No prior backend setup is assumed.

---

## Step 1 — Install and verify (5 minutes)

```bash
cd backend
npm install        # installs dependencies (one-time)
npm run typecheck  # should print "typecheck clean" style output, no errors
npm test           # should end with "27 passed, 0 failed"
npm run demo       # prints a full sample profile + a sample check-in
```

If all three succeed, the backend works on your machine. Nothing here touches
the internet or a real database yet — `npm test` and `npm run demo` use an
in-memory SQLite database that disappears when the process ends.

---

## Step 2 — Understand the two things you store

1. **Profile** — set once, edited occasionally. Organised into groups
   (identity, contact, sport, anthropometrics, training, nutrition, recovery,
   health, goals, advanced, schedule). See the field table in `README.md`.
2. **Daily check-in** — logged every day. Sleep, energy, stress, hydration,
   soreness, mood, and what training is planned/done.

The required core of a profile is small (name, age or DOB, sex, sport,
position, competition level, height, weight, and the nutrition arrays). The
rest is optional and can be filled in over time — good for onboarding, where
you ask the priority fields first and let athletes complete their profile later.

> Recommended onboarding order (matches the "build from scratch" priority):
> 1) age/height/weight → 2) sport & position → 3) allergies/restrictions →
> 4) training schedule → 5) sleep habits → 6) goals → 7) daily check-ins.

---

## Step 3 — Run the API locally

The endpoints are Netlify Functions. To serve them on your machine:

```bash
npm install -g netlify-cli   # one-time
npm run dev                  # serves at http://localhost:8888
```

Create a profile (the `x-owner-id` header identifies the athlete; it's a
placeholder for real login — see Step 6):

```bash
curl -X POST http://localhost:8888/api/profiles \
  -H "x-owner-id: athlete-123" \
  -H "content-type: application/json" \
  -d '{
    "timezone": "America/New_York",
    "identity": { "fullName": "Sam Player", "dateOfBirth": "2006-09-01", "sex": "male" },
    "sport": { "primarySport": "soccer", "positions": ["midfielder"], "competitionLevel": "high_school" },
    "anthropometrics": { "heightCm": 175, "bodyMassKg": 68 },
    "nutrition": { "allergies": [], "dietaryRestrictions": [], "intolerances": [], "dislikes": [] }
  }'
```

The response includes the new profile's `id`. Use it to log a check-in:

```bash
curl -X POST http://localhost:8888/api/profiles/THE_PROFILE_ID/checkins \
  -H "x-owner-id: athlete-123" \
  -H "content-type: application/json" \
  -d '{ "date": "2026-06-02", "sleepHoursLastNight": 7.5, "energyLevel": 8, "sorenessLevel": 3, "mood": "good", "trainingPlanned": "match" }'
```

List recent check-ins: `GET /api/profiles/THE_PROFILE_ID/checkins?limit=14`.

---

## Step 4 — Call it from your front end

From your app, send the same requests. Every request must include the
`x-owner-id` header (later this becomes an auth token). A minimal example:

```js
const OWNER = "athlete-123"; // later: the logged-in user's id

async function createProfile(profile) {
  const res = await fetch("/api/profiles", {
    method: "POST",
    headers: { "content-type": "application/json", "x-owner-id": OWNER },
    body: JSON.stringify(profile),
  });
  if (res.status === 422) {
    const { details } = await res.json(); // [{ path, message }, ...]
    return { ok: false, fieldErrors: details };
  }
  return { ok: true, profile: await res.json() };
}
```

Building the form: read the allowed values for dropdowns/checkboxes straight
from `src/domain/enums.ts` (e.g. `DIETS`, `RECOVERY_METHODS`, `GOALS`). When a
`422` comes back, map each `details[i].path` (e.g.
`"nutrition.allergies[0].note"`) to the matching input and show its `message`.

---

## Step 5 — Map the form fields to the groups

Your UI sections map 1:1 to the JSON groups:

- "Basic Information" → `identity` + `contact`
- "Athlete Basics" → `identity` (age/sex) + `anthropometrics` + `sport`
- "Training Profile" → `training`
- "Nutrition" → `nutrition`
- "Recovery" → `recovery`
- "Health" → `health`
- "Goals" → `goals`
- "Advanced (optional)" → `advanced`
- "Schedule context" → `schedule`
- "Daily Check-In" → the separate `/checkins` endpoint (not the profile)

Duplicates from the original list are handled for you: enter **date of birth OR
age** (age is computed from DOB); enter **allergies and restrictions once** (in
nutrition); **height/weight once** (anthropometrics); injuries and medications
live under `health`.

---

## Step 6 — Add real authentication (when ready)

Right now the owner id is a header. To make profiles truly private:

1. Add a login (Supabase Auth is the natural fit since you're heading there).
2. On each request, verify the token and set the owner id from the verified
   user instead of trusting the header. The only place to change is
   `getOwnerId()` in `netlify/functions/profiles.ts` and `checkins.ts`.
3. Everything else already scopes by owner id, so nothing else changes.

---

## Step 7 — Move from SQLite to Supabase (production)

SQLite is local-only; Netlify's servers can't persist it. For production:

1. Create a Supabase project.
2. In the Supabase SQL editor, run the schema + Row Level Security block at the
   bottom of `src/data/supabaseRepository.ts` (it creates both tables and the
   owner-only policies).
3. `npm install @supabase/supabase-js` and fill in the method bodies in
   `supabaseRepository.ts` (the SQLite versions are the exact behaviour to copy).
4. Set environment variables in Netlify:
   ```
   DB_BACKEND=supabase
   SUPABASE_URL=...
   SUPABASE_SERVICE_KEY=...
   ```
   `src/container.ts` reads `DB_BACKEND` and wires Supabase automatically — no
   other code changes.

---

## Step 8 — Deploy to Netlify

```bash
npm install -g netlify-cli
netlify login
netlify init      # link this folder to a Netlify site
netlify deploy --prod
```

Set the environment variables from Step 7 in the Netlify dashboard
(Site settings → Environment variables). Your endpoints will be live at
`https://YOUR-SITE.netlify.app/api/profiles` and `.../checkins`.

---

## Where to change things later

- **Add a field:** add it to the right interface in `src/domain/profile.ts`
  (or `checkin.ts`), add validation in `src/domain/validation.ts`, and — if it's
  enum-like — add the allowed values to `src/domain/enums.ts`. Storage needs no
  change (the whole object is saved as JSON).
- **Add a sport:** extend `SPORTS` in `enums.ts`; positions for non-soccer
  sports are accepted as free text today.
- **Change what's required:** edit the `required` flags in `validation.ts`.
