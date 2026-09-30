# Launch checklist

What is built, and the steps only you can do (they need your accounts). In order.

## 1. Ship the new web app (15 minutes)

1. **Supabase > SQL Editor**: open `supabase/002_teams_and_security.sql`, paste, Run. The last query should list 4 tables, all with `rowsecurity = true`.
2. **Supabase > Authentication > URL Configuration**: set Site URL to your Netlify URL and add `https://YOUR-SITE/?reset=1` under Redirect URLs. Password reset emails won't work without this.
3. **GitHub Desktop**: commit and push. Netlify deploys on its own.
4. On your phone, open the site, sign up, and run through: profile > add a game > Game Day > check-in > Recovery > Account > Delete account.

Netlify env vars: `DB_BACKEND`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_KEY`. Recommended: `NWS_USER_AGENT` = `AthletePerformanceApp (your-support-email)`. The National Weather Service asks apps to identify themselves with a contact email. Do NOT set `ALLOW_DEV_AUTH` or `WEATHER=demo` on Netlify.

New in this release:
- Run `supabase/003_records.sql` in the Supabase SQL editor (family links, device connections, usage limits).
- `APP_URL` = your site address, e.g. `https://your-site.netlify.app` (used for sign-in redirects and email links).
- `TOKEN_KEY` = a long random string (40+ characters). Encrypts wearable keys. Never change it after people connect devices.
- Weekly parent emails and team-join notices: `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain you verify in Resend). Without them, emails are skipped.
- Meal photos: `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`). Without it, the photo tab says it isn't set up.
- Barcode scanner: works with no key. Optional `OFF_USER_AGENT` = `AthletePerformance/1.0 (your-support-email)`.
- Whoop: create an app at developer.whoop.com, redirect URI `{APP_URL}/api/integrations/whoop/callback`, then set `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`.
- Oura: create an app at cloud.ouraring.com/oauth/applications, redirect URI `{APP_URL}/api/integrations/oura/callback`, then set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`. Oura allows 10 users until they approve the app.
- Garmin: apply at developer.garmin.com (Health API). Leave `GARMIN_APPROVED` unset until approved.
- Ask the app uses the same `ANTHROPIC_API_KEY` as meal photos.
- iPhone widgets (game countdown, emergency card): run `npm install` in `mobile/`, then `npx expo prebuild --clean` and an EAS build. The widget needs the App Group `group.com.guberuk.athleteperformance` enabled for the app ID in your Apple developer account (EAS can do this for you).
- Scheduled functions run on their own: `daily-sync` (calendars and devices, daily) and `weekly-report` (Sunday evening).

## 2. Use it with the team this week

On iPhone: open the site in Safari > Share > **Add to Home Screen**. It runs full-screen and opens offline at the field. Create a coach account, make a team, share the code.

## 3. Before the App Store

- **Name**: pick from `APP_STORE_LISTING.md`, then update `mobile/app.json` (`name`), `public/manifest.webmanifest`, and the `<title>` in `public/index.html`.
- **Domain** (recommended): point a real domain at Netlify, then update `extra.appUrl` in `mobile/app.json`.
- **Support email**: replace `support@example.com` in `public/privacy.html` and `public/terms.html`.
- **Legal review**: the Privacy Policy and Terms are solid drafts written for this app. Have a lawyer read them, mainly the children's section.
- **Bundle ID**: `com.guberuk.athleteperformance` in `mobile/app.json`. Change it now if you want a company name in it. It is permanent after the first upload.

## 4. Apple Developer account

- Enroll at developer.apple.com ($99/year). As an individual, the seller name shows as your name. As an LLC you need a D-U-N-S number and it takes longer.
- In App Store Connect: My Apps > + > New App, with the bundle ID above.

## 5. Build the iPhone app (no Mac needed)

From the `mobile` folder on your PC:

```
npm install
npx eas-cli@latest login          # free Expo account
npx eas-cli@latest build --platform ios --profile production
```

EAS asks to sign in to your Apple account and creates the certificates for you. The build runs on Expo's servers (about 15-25 minutes).

Then:

```
npx eas-cli@latest submit --platform ios --profile production
```

This uploads the build to App Store Connect. It appears in **TestFlight**. Add yourself, Josh and a few teammates as testers first.

## 6. Test on real phones (TestFlight)

Check the things the browser can't:

- Reminders arrive as notifications with the app closed.
- Tapping a check-in reminder opens the Check-in tab.
- Check-in > "Fill sleep from Apple Health" asks for permission and fills sleep.
- Airplane mode: the app shows the offline screen, and reminders still fire.

## 7. Submit for review

Fill in App Store Connect from `APP_STORE_LISTING.md`: description, keywords, screenshots (`mobile/store-screenshots/`), privacy answers, age rating, review notes with a demo login. Submit. Reviews usually take 1-3 days.

## If Apple pushes back

The most likely objection is guideline 4.2 ("minimum functionality", a website in a wrapper). The answer is already built: local notifications scheduled from the athlete's own schedule, and Apple Health integration. If they still object, the next step is to make the Today and Check-in screens native React Native. The backend stays the same.

## Local development

```
npm install
npm run devserver     # http://localhost:8888, local database, fake login for testing
npm test              # 116 checks
npm run typecheck
```
