# App Store listing (draft)

Everything below pastes straight into App Store Connect. Character limits are Apple's.

## Name (30 max)

The working name "Athlete Performance" is generic and probably taken. Pick one, then search the App Store to confirm nobody uses it:

- **Fuelday** (7)
- **GameFuel: Athlete Nutrition** (27)
- **Halftime: Fuel & Recovery** (25)
- **Kickoff Fuel** (12)

Changing the name later is one line in `mobile/app.json` plus the web app title.

## Subtitle (30 max)

Game-day fuel and recovery (26)

## Promotional text (170 max)

Know what to eat, when to eat it, and how to bounce back. Personal game-day plans built around your body, your schedule and your allergies.

## Description

Built for competitive youth and high school athletes, their parents, and their coaches.

GAME-DAY PLAN
Add your game and get an hour-by-hour plan: pre-game meal, top-up snack, half-time fuel, and what to eat in the first 30 minutes after. Every number scales to your body weight. Early kickoff? The plan adjusts your meal and alarm.

RECOVERY THAT KNOWS YOUR SCHEDULE
Two games in one day, or three in a weekend? The app links them into a tournament plan with fast-refuel windows between games and a day-by-day recovery plan after.

30-SECOND CHECK-IN
Sleep, energy, soreness, stress, hydration. You get a readiness score and advice for the day. On iPhone, fill sleep straight from Apple Health.

REMINDERS THAT MATTER
Carb dinner the night before. Pre-game meal. Pack your bottles. Recovery snack now. Wind down for bed. Timed from your own wake-up, bedtime and schedule.

ALLERGY-SAFE BY DESIGN
Tell us about allergies, diets and intolerances once. Food suggestions and the weekly grocery list never include what you can't eat.

TRENDS
Readiness, sleep and training load over four weeks, with an early warning when this week's load spikes above your normal.

FOR PARENTS
Manage plans for one or more kids from a single parent account. Children under 13 use the app through a parent account.

FOR COACHES
Create a team and share a join code. See who checked in, who is flagged low, who has an injury on file, and every player's allergies before team meals. Players choose to join and can leave any time. Coaches never see contact details or medical notes.

PRIVATE
No ads. No selling data. Delete your account and everything in it from inside the app.

The app gives general sports-nutrition education based on published research. It is not medical advice.

## Keywords (100 max, comma separated, no spaces)

soccer,nutrition,athlete,meal,recovery,hydration,sports,game,coach,team,youth,readiness,fuel

(92 characters. "Tournament" is already in the description, which Apple also indexes.)

## Categories

- Primary: Health & Fitness
- Secondary: Sports

Do NOT pick the Kids category. It forbids third-party login and adds strict rules. The app is for 13+ with parent-managed accounts for younger kids.

## Age rating questionnaire

Answer "None" to everything (no violence, no mature content, no gambling, no user-to-user chat, no unrestricted web access). Medical or treatment information: "None" or "Infrequent/Mild" (general nutrition education). Expect the lowest rating.

## App Privacy ("nutrition label")

Data used to track you: **No.**

Data linked to you (collected, used for App Functionality only):

| Apple category | What |
|---|---|
| Contact Info: Email Address | Login email |
| Contact Info: Name | Athlete name |
| Contact Info: Phone Number | Optional parent / emergency phone |
| Health & Fitness: Health | Check-ins, allergies, intolerances, Apple Health sleep and heart data |
| Health & Fitness: Fitness | Training minutes and effort |
| User Content: Photos | Optional profile photo |
| User Content: Other User Content | Check-in notes, schedule |
| Identifiers: User ID | Account ID |

Not collected: location, contacts, browsing, purchases, diagnostics, advertising data.

## Review notes for Apple

Paste into App Review Information > Notes:

> Demo login: (create one and put it here, with a profile and a game on the schedule).
>
> Native features: local notifications for fueling, hydration, recovery and sleep reminders (scheduled on-device from the athlete's schedule, More > Reminders); Apple Health read-only access to sleep, resting heart rate and HRV (Check-in tab > "Fill sleep from Apple Health"). The app never writes to Health.
>
> Account deletion: More > Account > Delete account.
>
> Nutrition guidance is general education from published sports-nutrition research, with a disclaimer on every plan. Users under 13 can only use the app through a parent account.

## Screenshots

`mobile/store-screenshots/` has seven 1320 x 2868 screenshots (the 6.9" iPhone size Apple asks for) plus the 1024 x 1024 icon. Upload in this order: Today, Game Day, Recovery, Check-in, Trends, Grocery, Coach roster. They were taken from a seeded demo account. Re-shoot after picking the final name if the icon changes.

## URLs

- Privacy Policy URL: https://YOUR-SITE/privacy.html
- Support URL: https://YOUR-SITE/ (or a simple support page)
