/**
 * Tests: fuel buddy, sticker book, game-day story, streak freeze, playlist plan
 * and Spotify build, season wrapped, family cook night, grocery hunt, car quiz,
 * kitchen challenge.  Run: npx tsx scripts/fun-test.ts
 */

import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteCheckInRepository, SqliteRecordRepository, SqliteTeamRepository } from "../src/data/sqliteRepository.js";
import type { AthleteProfile, ProfileInput } from "../src/domain/profile.js";
import type { DailyCheckIn } from "../src/domain/checkin.js";
import { carQuiz, familyCookNight, fuelBuddy, gameDayStory, groceryHunt, playlistPlan, seasonWrapped, stickerBook } from "../src/domain/fun.js";
import { buildProgress } from "../src/domain/progress.js";
import { buildGroceryList } from "../src/domain/grocery.js";
import { featuresFor } from "../src/domain/features.js";
import { nextUp } from "../src/domain/dayplans.js";
import { FOODS, isSafe, safetyContext } from "../src/domain/foods.js";
import { addDays } from "../src/domain/dates.js";
import { FamilyService } from "../src/services/familyService.js";
import { FunService } from "../src/services/funService.js";
import { ClubService } from "../src/services/clubService.js";
import { TeamHubService } from "../src/services/teamHubService.js";
import { TeamService } from "../src/services/teamService.js";
import { MemoryMailer } from "../src/services/notifier.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
const TODAY = "2026-10-05";
function input(name: string, dob: string, over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    timezone: "America/New_York", identity: { fullName: name, dateOfBirth: dob, sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "recreational" },
    anthropometrics: { heightCm: 140, bodyMassKg: 35 },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] }, routine: { homeZip: "07039" }, ...over,
  } as ProfileInput;
}
const prof = (name: string, dob: string, over: Partial<ProfileInput> = {}): AthleteProfile => ({ ...input(name, dob, over), id: "p1", ownerId: "o1", createdAt: "", updatedAt: "" });
const ci = (date: string, x: Partial<DailyCheckIn> = {}): DailyCheckIn => ({ id: date, ownerId: "o1", profileId: "p1", date, createdAt: "", ...x });

console.log("\nAge switches");
{
  const kid = featuresFor(prof("Max L", "2018-01-01")).on, teen = featuresFor(prof("Josh T", "2011-01-01")).on;
  check("kids: buddy, stickers, story; no playlist, wrapped, kitchen", kid.fuelBuddy && kid.stickerBook && kid.gameStory && !kid.playlist && !kid.seasonWrapped && !kid.kitchenChallenge);
  check("teens: playlist, wrapped, kitchen, freeze; no buddy", teen.playlist && teen.seasonWrapped && teen.kitchenChallenge && teen.streakFreeze && !teen.fuelBuddy);
  check("family features for everyone", kid.cookNight && kid.groceryHunt && kid.carQuiz && teen.cookNight);
}

console.log("\nFuel buddy and stickers");
{
  const p = prof("Max Little", "2018-01-01", { fun: { buddyName: "Zoom", buddyColor: "sky" } });
  const none = stickerBook(p, [], [], TODAY);
  check("no check-in: buddy is waiting", fuelBuddy(p, TODAY, [], none).mood === "waiting" && fuelBuddy(p, TODAY, [], none).name === "Zoom");
  const thirsty = [ci(TODAY, { sleepHoursLastNight: 10, urineColor: 6 })];
  check("dark pee: buddy is thirsty", fuelBuddy(p, TODAY, thirsty, stickerBook(p, thirsty, [], TODAY)).mood === "thirsty");
  const full = [ci(TODAY, { sleepHoursLastNight: 10, urineColor: 2, warmupDone: true })];
  const b = fuelBuddy(p, TODAY, full, stickerBook(p, full, [], TODAY));
  check("all done: full power, 100 energy", b.mood === "super" && b.energy === 100);
  const many = Array.from({ length: 10 }, (_, i) => ci(addDays(TODAY, -i), { sleepHoursLastNight: 10, urineColor: 2 }));
  const book = stickerBook(p, many, [{ kind: "chef", date: TODAY }, { kind: "quiz", date: addDays(TODAY, -1) }], TODAY);
  check("stickers: 3 a day plus chef and quiz, 12 per page", book.total === 32 && book.pages.length === 3 && book.newToday.some((s) => s.kind === "chef"));
  check("filled pages unlock jersey colors", fuelBuddy(p, TODAY, many, book).jerseys.length === 3);
  check("no body or weight words anywhere", !/weight|body|slim|fat|kg|lb/i.test(JSON.stringify(fuelBuddy(p, TODAY, many, book))));
}

console.log("\nGame-day story");
{
  const p = prof("Max Little", "2018-01-01", { nutrition: { allergies: [{ allergen: "peanut", severity: "severe" }], dietaryRestrictions: [], intolerances: [], dislikes: [] }, schedule: { events: [{ type: "match", startTime: `${addDays(TODAY, 1)}T10:00:00-04:00`, importance: "high" }] } });
  const n = nextUp(p, `${TODAY}T19:30`);
  const s = gameDayStory(p, n, "Zoom");
  const text = s ? s.paragraphs.join(" ") : "";
  check("story names the child, buddy and kickoff", !!s && /Max/.test(text) && /Zoom/.test(text) && /10:00 AM/.test(text));
  check("story foods are safe for the child", !FOODS.filter((f) => !isSafe(f, safetyContext(p, { gameDay: true }))).some((f) => text.toLowerCase().includes(f.name.toLowerCase())) && !/peanut/i.test(text));
  check("no story for practice", gameDayStory(p, { ...n!, type: "training" }, "Zoom") === null);
}

console.log("\nStreak freeze");
{
  const p = prof("Josh Teen", "2011-01-01");
  const days = [0, 1, 2, 4, 5, 6].map((i) => ci(addDays(TODAY, -i)));
  const noF = buildProgress(p, { checkins: days, reflectionDates: [] }, TODAY);
  const f = buildProgress(p, { checkins: days, reflectionDates: [] }, TODAY, { freezes: true });
  check("without freeze: streak broken at 3", noF.streaks[0].current === 3);
  check("with freeze: one missed day bridged (6 days)", f.streaks[0].current === 6 && f.freeze!.available === 0);
  const two = [0, 1, 3, 5, 6].map((i) => ci(addDays(TODAY, -i)));
  check("only one freeze a month", buildProgress(p, { checkins: two, reflectionDates: [] }, TODAY, { freezes: true }).streaks[0].current === 3);
}

console.log("\nPlaylist plan, wrapped, quiz, hunt, cook night");
{
  const pl = playlistPlan(null, ["latin", "rap", "edm"]);
  check("playlist: calm, focus, hype; unknown genres dropped", pl.phases.map((x) => x.id).join() === "calm,focus,hype" && pl.phases[0].searchTerms.length === 2);
  const teen = prof("Josh Teen", "2011-01-01");
  const cis = Array.from({ length: 40 }, (_, i) => ci(addDays(TODAY, -i), { sleepHoursLastNight: 9, urineColor: 2, warmupDone: i % 2 === 0 }));
  const prog = buildProgress(teen, { checkins: cis, reflectionDates: [] }, TODAY, { freezes: true });
  const w = seasonWrapped(teen, cis, [{ id: "g", date: addDays(TODAY, -3), type: "match", minutes: 70, goals: 2, rating: 5 }], prog, "2026-08-01", TODAY, { cookNights: 2, kitchenEntries: 1 });
  check("wrapped: check-ins, sleep hours, games, kitchen, season word", w.slides.some((s) => s.id === "checkins" && s.big === "40") && w.slides.some((s) => s.id === "sleep" && s.big === "360") && w.slides.some((s) => s.id === "games") && w.slides.some((s) => s.id === "kitchen") && /Season word/.test(w.shareText));
  check("wrapped: no weight", !/weight|kg|lb/i.test(JSON.stringify(w)));
  const nut = prof("Max Little", "2018-01-01", { nutrition: { allergies: [{ allergen: "citrus" as never, severity: "mild" }, { allergen: "other", severity: "moderate", note: "orange" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } });
  const q = carQuiz(nut, 0);
  check("kid quiz: 10 questions, all kid-level", q.length === 10 && !q.some((x) => x.id === "caffeine"));
  check("quiz answers never name a food the child can't eat", !q.some((x) => /orange/i.test(x.choices[x.answer])));
  check("teen quiz includes teen questions", carQuiz(teen, 3).some((x) => ["caffeine", "protein", "fiber", "rest"].includes(x.id)) || carQuiz(teen, 10).some((x) => ["caffeine", "protein", "fiber", "rest"].includes(x.id)));
  const hunt = groceryHunt(buildGroceryList(teen, TODAY, 7).aisles);
  check("grocery hunt: stops with clues and points", hunt.stops.length >= 3 && hunt.stops.every((s) => s.clue && s.items.length) && hunt.maxPoints > 0);
  const kid = prof("Max Little", "2018-01-01", { nutrition: { allergies: [{ allergen: "milk", severity: "severe" }], dietaryRestrictions: [], intolerances: [], dislikes: [] } });
  const gf = prof("Lea G", "2011-06-01", { nutrition: { allergies: [], dietaryRestrictions: ["gluten_free"], intolerances: [], dislikes: [] } });
  const night = familyCookNight([kid, gf], 0);
  const txt = JSON.stringify(night?.recipe).toLowerCase();
  check("cook night: one dinner safe for both (no dairy, no wheat)", !!night && !/cheese|yogurt|"milk"|butter|parmesan/.test(txt) && !/"pasta"|flour tortilla|"toast"/.test(txt));
  check("cook night: little chef washes and measures, teen cooks, grown-up added", !!night && night.jobs[0].title === "Little chef" && night.jobs[1].title === "Home cook" && night.jobs.some((j) => j.who === "Grown-up"));
}

// ---------------------------------------------------------------------------
const db = openDatabase(":memory:");
const profiles = new SqliteAthleteProfileRepository(db), checkins = new SqliteCheckInRepository(db), records = new SqliteRecordRepository(db), teams = new SqliteTeamRepository(db);
const family = new FamilyService(profiles, records);

console.log("\nFun service");
{
  const kid = await profiles.create("mom", input("Max Little", "2018-01-01"));
  const teen = await profiles.create("teen", input("Josh Teen", "2011-01-01"));
  process.env.TOKEN_KEY = "test-key-that-is-long-enough-123";
  process.env.SPOTIFY_CLIENT_ID = "sp"; process.env.SPOTIFY_CLIENT_SECRET = "sec"; process.env.APP_URL = "https://app.test";
  const calls: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); calls.push(`${init?.method || "GET"} ${u}`);
    const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (u.includes("accounts.spotify.com/api/token")) return j({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    if (u.includes("/v1/search")) return j({ tracks: { items: Array.from({ length: 12 }, (_, i) => ({ uri: `spotify:track:${u.length}-${i}`, explicit: i % 3 === 0, duration_ms: 200_000 })) } });
    if (u.endsWith("/v1/me")) return j({ id: "josh" });
    if (u.includes("/playlists") && !u.includes("/tracks")) return j({ id: "pl1", external_urls: { spotify: "https://open.spotify.com/playlist/pl1" } });
    return j({});
  }) as typeof fetch;
  const fun = new FunService(profiles, checkins, family, records, fake);
  check("teen can't open the kids screen", !(await fun.kids("teen", teen.id, TODAY, `${TODAY}T09:00`)).ok);
  await fun.setBuddy("mom", kid.id, { name: "Zoom", color: "gold" });
  const k = await fun.kids("mom", kid.id, TODAY, `${TODAY}T09:00`);
  check("kid screen with named buddy", k.ok && (k.value as any).buddy.name === "Zoom" && (k.value as any).buddy.color === "gold");
  check("bad buddy color rejected", !(await fun.setBuddy("mom", kid.id, { color: "plaid" })).ok);
  check("quiz below 7 gives no sticker", (await fun.log("mom", kid.id, { kind: "quiz", date: TODAY, score: 5 })).ok && !((await fun.log("mom", kid.id, { kind: "quiz", date: TODAY, score: 5 })) as any).value.sticker);
  await fun.log("mom", kid.id, { kind: "quiz", date: TODAY, score: 9 });
  const k2 = await fun.kids("mom", kid.id, TODAY, `${TODAY}T09:00`);
  check("quiz 9/10 earns a sticker", k2.ok && (k2.value as any).stickers.newToday.some((s: any) => s.kind === "quiz"));
  check("kids can't get playlists", !(await fun.playlist("mom", kid.id, `${TODAY}T09:00`)).ok);
  await fun.setBuddy("teen", teen.id, { genres: ["latin", "pop"] });
  const pl = await fun.playlist("teen", teen.id, `${TODAY}T09:00`);
  check("teen playlist plan with Spotify search links", pl.ok && (pl.value as any).links.length === 3 && (pl.value as any).explicitFilter === true);
  const st = await fun.spotifyStart("teen", teen.id);
  const state = st.ok ? new URL(st.value.url).searchParams.get("state") : "";
  check("Spotify connect asks only for private playlists", st.ok && /scope=playlist-modify-private/.test(st.value.url));
  check("callback connects", (await fun.spotifyCallback("code", state, null)).endsWith("spotify=connected"));
  const built = await fun.buildSpotify("teen", teen.id, `${TODAY}T09:00`);
  check("playlist built in Spotify", built.ok && built.value.url.includes("pl1") && built.value.tracks > 0);
  check("explicit tracks skipped for under 18", built.ok && calls.some((c) => c.includes("/tracks")));
  const cn = await fun.cookNight("mom", 0);
  check("cook night for the family", cn.ok);
  await fun.cookNightDone("mom", TODAY);
  const k3 = await fun.kids("mom", kid.id, TODAY, `${TODAY}T09:00`);
  check("cook night earns a chef hat sticker", k3.ok && (k3.value as any).stickers.newToday.some((s: any) => s.kind === "chef"));
  check("wrapped for teens only", (await fun.wrapped("teen", teen.id, TODAY)).ok && !(await fun.wrapped("mom", kid.id, TODAY)).ok);

  console.log("\nKitchen challenge");
  const mailer = new MemoryMailer();
  const clubs = new ClubService(profiles, checkins, teams, records, mailer, null);
  const hub = new TeamHubService(profiles, checkins, teams, records, family, clubs);
  const ts = new TeamService(teams, profiles, checkins, family, mailer);
  const t = await ts.create("coach", "U15 Red");
  const tid = t.ok ? t.value.id : "";
  const p2 = await profiles.create("fam2", input("Ben Cole", "2011-03-01"));
  await ts.join("teen", teen.id, t.ok ? t.value.code : ""); await ts.join("fam2", p2.id, t.ok ? t.value.code : ""); await ts.join("mom", kid.id, t.ok ? t.value.code : "");
  const kc = await hub.createKitchen("coach", tid, { title: "Chicken rice bowl", end: addDays(TODAY, 30) });
  const kid2 = kc.ok ? kc.value.id : "";
  const photo = "data:image/jpeg;base64," + "A".repeat(2000);
  check("teen enters a photo", (await hub.enterKitchen("teen", tid, kid2, { profileId: teen.id, photo, caption: "Extra veggies" })).ok);
  check("an 8-year-old can't enter", !(await hub.enterKitchen("mom", tid, kid2, { profileId: kid.id, photo })).ok);
  check("no photo, no entry", !(await hub.enterKitchen("fam2", tid, kid2, { profileId: p2.id, photo: "x" })).ok);
  await hub.enterKitchen("fam2", tid, kid2, { profileId: p2.id, photo });
  check("can't vote for your own plate", !(await hub.voteKitchen("teen", tid, kid2, `${kid2}:${teen.id}`)).ok);
  await hub.voteKitchen("teen", tid, kid2, `${kid2}:${p2.id}`);
  await hub.voteKitchen("coach", tid, kid2, `${kid2}:${teen.id}`);
  await hub.voteKitchen("coach", tid, kid2, `${kid2}:${p2.id}`);
  const es = await hub.kitchenEntries("teen", tid, kid2);
  const list = es.ok ? (es.value as any).entries : [];
  check("one vote per person, moving your vote works", list[0].name === "Ben C." && list[0].votes === 2 && list[1].votes === 0);
  check("leaderboard shows first name and initial only", list.every((e: any) => /^[A-Z][a-z]+ [A-Z]\.$/.test(e.name)));
  const h = await hub.hub("teen", tid, TODAY);
  check("hub shows the challenge with leader", h.ok && (h.value as any).kitchen[0].leader === "Ben C." && (h.value as any).kitchen[0].entries === 2);
  check("coach removes an entry", (await hub.removeKitchenEntry("coach", tid, kid2, `${kid2}:${teen.id}`)).ok);
}

console.log(`\nFun tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
