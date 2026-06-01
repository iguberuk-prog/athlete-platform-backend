# Deploying to Netlify (with Supabase) — Step by Step

This gets your backend live on Netlify, with profiles and check-ins saved
permanently in Supabase. Plan ~30–45 minutes the first time.

Order: **Supabase first** (the database), then **GitHub** (the code), then
**Netlify** (connects the two and runs your API).

---

## Part A — Set up Supabase (the database)

1. Go to https://supabase.com, sign in, and click **New project**. Pick a name,
   a strong database password, and a region close to your users.
2. Wait for the project to finish provisioning (~2 minutes).
3. In the left sidebar open **SQL Editor → New query**. Open the file
   `backend/supabase_schema.sql` from this project, copy its entire contents,
   paste into the editor, and click **Run**. You should see "Success". This
   creates the `athlete_profiles` and `daily_checkins` tables.
4. Get your two secrets: open **Project Settings → API**. Copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **service_role** key (under "Project API keys" — the secret one, *not*
     the anon key). Keep this private; it has full database access.

Keep these two values handy for Part C.

---

## Part B — Put the code on GitHub

> First, a cleanup: there may be a half-created `backend\.git` folder from an
> earlier step. In Windows File Explorer, open the `backend` folder, turn on
> "Hidden items" (View menu), and delete the `.git` folder if present. Then:

Easiest path — **GitHub Desktop** (no command line):

1. Install GitHub Desktop (https://desktop.github.com) and sign in.
2. **File → Add local repository** → choose the `backend` folder. When it says
   "this isn't a Git repository", click **create a repository**.
3. Give it a name (e.g. `athlete-platform-backend`), keep the rest default,
   click **Create repository**. (The included `.gitignore` keeps `node_modules`,
   the local database, and secrets out of the repo automatically.)
4. Click **Publish repository**. Choose **Private**. Done — your code is on
   GitHub.

Prefer the command line? From inside `backend`:

```bash
git init
git add -A
git commit -m "Athlete profile + daily check-in backend"
# create an empty repo on github.com first, then:
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/athlete-platform-backend.git
git push -u origin main
```

---

## Part C — Connect Netlify and deploy

1. Go to https://netlify.com, sign in, and click **Add new site → Import an
   existing project**.
2. Choose **GitHub**, authorize Netlify, and pick the repository you just
   created.
3. Configure the site:
   - **Base directory:** `backend`  ← important
   - **Build command:** leave **empty**
   - **Publish directory:** `backend` (or leave Netlify's default; the
     `netlify.toml` already sets it)
   - Functions are detected automatically from `backend/netlify/functions`.
4. Before the first deploy, open **Site configuration → Environment variables**
   and add three:
   - `DB_BACKEND` = `supabase`
   - `SUPABASE_URL` = the Project URL from Part A
   - `SUPABASE_SERVICE_KEY` = the service_role key from Part A
5. Click **Deploy**. When it finishes you'll get a URL like
   `https://YOUR-SITE.netlify.app`.

---

## Part D — Test the live API

Replace `YOUR-SITE` below. Create a profile:

```bash
curl -X POST https://YOUR-SITE.netlify.app/api/profiles \
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

You'll get back the new profile with an `id`. Then list it (same owner header):

```bash
curl https://YOUR-SITE.netlify.app/api/profiles -H "x-owner-id: athlete-123"
```

Open the Supabase **Table Editor → athlete_profiles** and you'll see the row.
Log a check-in:

```bash
curl -X POST https://YOUR-SITE.netlify.app/api/profiles/THE_PROFILE_ID/checkins \
  -H "x-owner-id: athlete-123" -H "content-type: application/json" \
  -d '{ "date": "2026-06-02", "sleepHoursLastNight": 7.5, "energyLevel": 8, "mood": "good" }'
```

---

## How updates work from now on

Every time you push to GitHub (GitHub Desktop: **Commit**, then **Push**),
Netlify automatically rebuilds and redeploys. No manual step.

---

## Important notes

- **Auth is not real yet.** Right now anyone who sends `x-owner-id: athlete-123`
  acts as that athlete. That's fine for testing, **not** for real users. The next
  milestone is adding Supabase Auth so the owner id comes from a verified login;
  the code is already structured for it (only `getOwnerId()` in the two function
  files changes, plus the RLS note in `supabase_schema.sql`).
- **Keep the service_role key secret.** It lives only in Netlify's environment
  variables and your local `.env` (which is git-ignored). Never put it in
  frontend code.
- **Local development is unchanged.** Without `DB_BACKEND=supabase`, everything
  still runs on local SQLite (`npm test`, `npm run demo`, `npm run dev`).
- **To test Supabase locally** before deploying: copy `.env.example` to `.env`,
  fill in the two Supabase values, and run `npm run dev`.
