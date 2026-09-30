/**
 * Tests: team app catalog and link detection, TeamSnap and Google Calendar
 * sign-in (mocked), picking teams/calendars, daily sync, keyword filter,
 * sign-out, and that calendar links still work.  Run: npx tsx scripts/connect-test.ts
 */

process.env.TOKEN_KEY = "test-token-key-0123456789";
process.env.TEAMSNAP_CLIENT_ID = "ts-id"; process.env.TEAMSNAP_CLIENT_SECRET = "ts-secret";
process.env.GOOGLE_CLIENT_ID = "g-id"; process.env.GOOGLE_CLIENT_SECRET = "g-secret";
process.env.APP_URL = "https://app.test";

import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteRecordRepository } from "../src/data/sqliteRepository.js";
import type { ProfileInput } from "../src/domain/profile.js";
import { TEAM_APPS, detectApp, googleToScheduled, teamsnapToScheduled } from "../src/domain/teamApps.js";
import { validateProfileInput } from "../src/domain/validation.js";
import { FamilyService } from "../src/services/familyService.js";
import { CalendarService, feedLinkIn, normalizeFeedUrl } from "../src/services/calendarService.js";
import { ConnectService } from "../src/services/connectService.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// ---- catalog ----
check("catalog has 20+ apps", TEAM_APPS.length >= 20);
check("TeamSnap and Google are sign-in", TEAM_APPS.find((a) => a.id === "teamsnap")?.kind === "signin" && TEAM_APPS.find((a) => a.id === "google")?.kind === "signin");
check("every app has steps", TEAM_APPS.every((a) => a.steps.length >= 2));
check("detect SportsEngine link", detectApp("webcal://www.sportngin.com/ical/team/123.ics")?.id === "sportsengine");
check("detect PlayMetrics link", detectApp("https://api.playmetrics.com/calendar/abc.ics")?.id === "playmetrics");
check("detect GameChanger link", detectApp("webcal://api.team-manager.gc.com/ics-calendar-documents/x.ics")?.id === "gamechanger");
check("unknown host: no guess", detectApp("https://example.org/cal.ics") === undefined);
check("junk: no crash", detectApp("not a url") === undefined);

// ---- messy pastes ----
check("paste: http:// becomes https://", normalizeFeedUrl("http://ical.teamsnap.com/team_schedule/abc.ics") === "https://ical.teamsnap.com/team_schedule/abc.ics");
check("paste: webcal:// becomes https://", normalizeFeedUrl("webcal://ical.teamsnap.com/x.ics") === "https://ical.teamsnap.com/x.ics");
check("paste: spaces and quotes trimmed", normalizeFeedUrl('  "webcal://a.teamsnap.com/x.ics"  \n') === "https://a.teamsnap.com/x.ics");
check("paste: link inside other words", normalizeFeedUrl("Full calendar: webcal://a.teamsnap.com/x.ics (copy this)") === "https://a.teamsnap.com/x.ics");
check("paste: no protocol", normalizeFeedUrl("go.teamsnap.com/ical/123.ics") === "https://go.teamsnap.com/ical/123.ics");
check("paste: plain words refused", normalizeFeedUrl("my team calendar") === null);
check("paste: local addresses refused", normalizeFeedUrl("http://192.168.1.5/cal.ics") === null);

// ---- pasted a page instead of the feed ----
check("page link: finds webcal link", feedLinkIn('<a href="/help">Help</a><a href="webcal://club.sportngin.com/ical/team/9.ics">Subscribe</a>', "https://club.sportngin.com/schedule") === "https://club.sportngin.com/ical/team/9.ics");
check("page link: finds relative .ics", feedLinkIn('<a href="/download/mls-2026-UTC.ics">Download</a>', "https://fixturedownload.com/download/ics/mls-2026") === "https://fixturedownload.com/download/mls-2026-UTC.ics");
check("page link: skips 'ical instructions' help pages", feedLinkIn('<a href="/event/ical_instructions">How</a>', "https://x.com/") === null);
check("page link: none on an ordinary page", feedLinkIn("<html><a href='/about'>About</a></html>", "https://x.com/") === null);

// ---- mapping ----
const tsItems = [
  { id: 1, name: "Practice", start_date: day(2), is_game: false, duration_in_minutes: 90, location_name: "Memorial Field, Livingston, NJ 07039" },
  { id: 2, name: "", formatted_title: "vs. Lions", start_date: day(4), is_game: true, opponent_name: "Lions", duration_in_minutes: 80 },
  { id: 3, name: "Game", start_date: day(5), is_game: true, is_canceled: true },
  { id: 4, name: "Old game", start_date: day(-40), is_game: true },
  { id: 5, name: "Spring Cup", start_date: day(9), is_game: true },
];
const ts = teamsnapToScheduled(tsItems, "f1", "America/New_York", Date.now() - 14 * 86_400_000, Date.now() + 180 * 86_400_000, "07078");
check("TeamSnap: practice + game + tournament, cancelled and old skipped", ts.length === 3, JSON.stringify(ts.map((e) => e.type)));
check("TeamSnap: practice is training with ZIP from field", ts[0].type === "training" && ts[0].zip === "07039" && ts[0].durationMin === 90);
check("TeamSnap: game is a high-importance match", ts[1].type === "match" && ts[1].importance === "high" && ts[1].title === "vs. Lions" && ts[1].zip === "07078");
check("TeamSnap: 'Cup' reads as tournament", ts[2].type === "tournament");
check("TeamSnap: times in the player's zone", /T\d\d:\d\d:00[-+]\d\d:\d\d$/.test(ts[0].startTime));

const gItems = [
  { id: "a", summary: "Josh soccer practice", start: { dateTime: day(1) }, end: { dateTime: new Date(Date.parse(day(1)) + 5400000).toISOString() } },
  { id: "b", summary: "Dentist", start: { dateTime: day(2) } },
  { id: "c", summary: "Lions U14 vs Eagles", start: { dateTime: day(3) }, location: "Field 2, Morristown, NJ 07960" },
  { id: "d", summary: "Team pizza party", start: { dateTime: day(3) } },
  { id: "e", summary: "Soccer game", start: { dateTime: day(4) }, status: "cancelled" },
  { id: "f", summary: "U14 Lions", start: { dateTime: day(6) } },
];
const gNo = googleToScheduled(gItems, "g1", "America/New_York", []);
check("Google, no words: only clear games/practices", gNo.map((e) => e.uid).join() === "g-a,g-c", gNo.map((e) => e.uid).join());
const gKw = googleToScheduled(gItems, "g1", "America/New_York", ["lions", "soccer"]);
check("Google, with words: keyword events come in, dentist stays out", gKw.map((e) => e.uid).join() === "g-a,g-c,g-f", gKw.map((e) => e.uid).join());
check("Google: duration and ZIP", gNo[0].durationMin === 90 && gNo[1].zip === "07960" && gNo[1].type === "match");

// ---- validation ----
const base: ProfileInput = {
  timezone: "America/New_York", identity: { fullName: "Josh T", dateOfBirth: "2011-05-01", sex: "male" },
  sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
  anthropometrics: { heightCm: 170, bodyMassKg: 60 },
  nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] }, routine: { homeZip: "07039" },
} as ProfileInput;
const withFeed = (f: object) => validateProfileInput({ ...base, schedule: { events: [], feeds: [f as any] } });
check("valid: signed-in TeamSnap feed", withFeed({ id: "x", url: "teamsnap:123", kind: "teamsnap" }).valid);
check("valid: signed-in Google feed with words", withFeed({ id: "x", url: "google:abc@group.calendar.google.com", kind: "google", keywords: ["soccer"] }).valid);
check("invalid: teamsnap: url without kind", !withFeed({ id: "x", url: "teamsnap:123" }).valid);
check("invalid: unknown kind", !withFeed({ id: "x", url: "https://a.com/x.ics", kind: "zoom" }).valid);
check("invalid: too many words", !withFeed({ id: "x", url: "google:a", kind: "google", keywords: Array(11).fill("a") }).valid);
check("valid: old-style link feed", withFeed({ id: "x", url: "webcal://www.sportngin.com/x.ics" }).valid);

// ---- full flow with mocked providers ----
const db = openDatabase(":memory:");
const profiles = new SqliteAthleteProfileRepository(db), records = new SqliteRecordRepository(db);
const family = new FamilyService(profiles, records);
const ICS = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:Practice\nDTSTART:${day(3).replace(/[-:]/g, "").slice(0, 15)}Z\nEND:VEVENT\nEND:VCALENDAR`;
const calendar = new CalendarService(profiles, family, async () => ICS);
let tokenCalls = 0, gFail = false;
const calls: string[] = [];
const http = (async (input: any, init?: any) => {
  const url = String(input);
  calls.push(`${init?.method || "GET"} ${url}`);
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("/oauth/token") || url.includes("oauth2.googleapis.com/token")) {
    tokenCalls++;
    const body = String(init?.body || "");
    if (!/client_secret=/.test(body)) return j({ error: "no secret" }, 400);
    return j({ access_token: `tok${tokenCalls}`, refresh_token: "ref", expires_in: 3600 });
  }
  if (url.endsWith("/v3/me")) return j({ collection: { items: [{ data: [{ name: "id", value: 77 }, { name: "email", value: "igor@example.com" }] }] } });
  if (url.includes("/v3/teams/search?user_id=77")) return j({ collection: { items: [
    { data: [{ name: "id", value: 501 }, { name: "name", value: "Lions U14" }, { name: "season_name", value: "Fall 2026" }] },
    { data: [{ name: "id", value: 502 }, { name: "name", value: "HS Varsity" }] },
  ] } });
  if (url.includes("/v3/events/search?team_id=501")) return j({ collection: { items: tsItems.map((e) => ({ data: Object.entries(e).map(([name, value]) => ({ name, value })) })) } });
  if (url.includes("/v3/events/search?team_id=502")) return j({ collection: { items: [] } });
  if (url.includes("/calendars/primary") && !url.includes("/events")) return j({ id: "family@gmail.com" });
  if (url.includes("/users/me/calendarList")) return j({ items: [{ id: "family@gmail.com", summary: "Family", primary: true }, { id: "club@group.calendar.google.com", summary: "Club soccer" }] });
  if (url.includes("/events?")) return gFail ? j({}, 401) : j({ items: gItems });
  return j({ error: "unexpected " + url }, 404);
}) as typeof fetch;
const svc = new ConnectService(profiles, family, records, calendar, http);

(async () => {
  const p = await profiles.create("u1", base);
  const other = await profiles.create("u2", { ...base, identity: { ...base.identity, fullName: "Someone Else" } });

  const ov = await svc.overview("u1", p.id);
  check("overview lists apps with sign-in available", ov.ok && (ov.value as any).apps.find((a: any) => a.id === "teamsnap").available === true);
  check("overview: another family's player is hidden", !(await svc.overview("u1", other.id)).ok);

  const st = await svc.start("u1", p.id, "teamsnap");
  check("start: TeamSnap sign-in page with state and redirect", st.ok && st.value.url.startsWith("https://auth.teamsnap.com/oauth/authorize?") && st.value.url.includes(encodeURIComponent("https://app.test/api/connect/teamsnap/callback")));
  const state = st.ok ? new URL(st.value.url).searchParams.get("state")! : "";
  check("callback: wrong provider refused", (await svc.callback("google", "code", state, null)).includes("error"));
  const st2 = await svc.start("u1", p.id, "teamsnap");
  const state2 = st2.ok ? new URL(st2.value.url).searchParams.get("state")! : "";
  const back = await svc.callback("teamsnap", "code", state2, null);
  check("callback: connected and back to the app", back === "https://app.test/#/connect?connected=teamsnap", back);
  check("callback: state can't be reused", (await svc.callback("teamsnap", "code", state2, null)).includes("error"));
  const rec = await records.get<any>("integration", `${p.id}:teamsnap`);
  check("token stored sealed, not in plain text", !!rec && !JSON.stringify(rec.data).includes("tok") && rec.data.account === "igor@example.com");

  const opts = await svc.options("u1", p.id, "teamsnap");
  check("options: the user's TeamSnap teams", opts.ok && opts.value.items.length === 2 && opts.value.items[0].name === "Lions U14" && opts.value.items[0].sub === "Fall 2026");
  const ch = await svc.choose("u1", p.id, "teamsnap", [{ id: "501", name: "Lions U14" }]);
  const evs = ch.ok ? ch.value.schedule!.events.filter((e) => e.uid?.startsWith("ts-")) : [];
  check("choose: TeamSnap events land on the schedule", evs.length === 3, String(evs.length));
  const feed = ch.ok ? ch.value.schedule!.feeds!.find((f) => f.kind === "teamsnap") : undefined;
  check("choose: feed saved with count and sync time", !!feed && feed.eventCount === 3 && !!feed.lastSyncedAt && feed.name === "Lions U14");
  const opts2 = await svc.options("u1", p.id, "teamsnap");
  check("options remember what's picked", opts2.ok && opts2.value.items[0].picked && !opts2.value.items[1].picked);
  const ch2 = await svc.choose("u1", p.id, "teamsnap", [{ id: "502", name: "HS Varsity" }]);
  check("re-choose: unpicked team and its games are removed", ch2.ok && !ch2.value.schedule!.events.some((e) => e.uid?.startsWith("ts-")) && ch2.value.schedule!.feeds!.filter((f) => f.kind === "teamsnap").length === 1);
  await svc.choose("u1", p.id, "teamsnap", [{ id: "501", name: "Lions U14" }, { id: "502", name: "HS Varsity" }]);

  // Google
  const gs = await svc.start("u1", p.id, "google");
  check("Google: offline access, read-only scope", gs.ok && gs.value.url.includes("access_type=offline") && gs.value.url.includes(encodeURIComponent("calendar.readonly")));
  await svc.callback("google", "code", new URL(gs.ok ? gs.value.url : "http://x").searchParams.get("state"), null);
  const go = await svc.options("u1", p.id, "google");
  check("Google: calendars listed", go.ok && go.value.items.length === 2 && go.value.items[0].sub === "Main calendar");
  const gc = await svc.choose("u1", p.id, "google", [{ id: "family@gmail.com", name: "Family" }], ["lions", "soccer"]);
  const gEvs = gc.ok ? gc.value.schedule!.events.filter((e) => e.uid?.startsWith("g-")) : [];
  check("Google: only soccer events from the family calendar", gEvs.length === 3 && !gEvs.some((e) => /dentist/i.test(e.title || "")), gEvs.map((e) => e.title).join("|"));

  // Calendar link still works, and daily sync covers everything
  const add = await calendar.add("u1", p.id, "webcal://www.sportngin.com/ical/1.ics");
  check("link feed: auto-named from the app", add.ok && add.value.schedule!.feeds!.at(-1)!.name === "SportsEngine calendar" && add.value.schedule!.feeds!.at(-1)!.app === "sportsengine");
  const cur = (await profiles.getById("u1", p.id))!;
  const synced = await calendar.syncProfile("u1", cur);
  check("daily sync: every feed synced without errors", !!synced && synced.schedule!.feeds!.every((f) => !f.lastError && f.lastSyncedAt), JSON.stringify(synced?.schedule?.feeds?.map((f) => f.lastError)));
  check("saved profile stays valid", validateProfileInput(synced as any).valid, JSON.stringify(validateProfileInput(synced as any).errors));

  const httpAdd = await calendar.add("u1", p.id, "  Full calendar: http://ical.teamsnap.com/team_schedule/9.ics ");
  check("add: messy TeamSnap http link accepted and cleaned", httpAdd.ok && httpAdd.value.schedule!.feeds!.some((f) => f.url === "https://ical.teamsnap.com/team_schedule/9.ics" && f.app === "teamsnap" && f.name === "TeamSnap calendar"));

  // A bad link is refused on the first add, not saved with an error
  const badCal = new CalendarService(profiles, family, async () => { throw new Error("The calendar site answered 404. Check the link."); });
  const bad = await badCal.add("u1", p.id, "https://example.com/nope.ics");
  check("bad link: refused with the reason, nothing saved", !bad.ok && /404/.test(bad.message || "") && !(await profiles.getById("u1", p.id))!.schedule!.feeds!.some((f) => f.url.includes("example.com")));

  // Expired sign-in shows as a problem on that feed, others keep working
  gFail = true;
  const s2 = await calendar.syncProfile("u1", (await profiles.getById("u1", p.id))!);
  const gFeed = s2!.schedule!.feeds!.find((f) => f.kind === "google");
  check("expired Google sign-in: feed shows 'sign in again', events kept", !!gFeed?.lastError && /sign in again/i.test(gFeed.lastError) && s2!.schedule!.events.some((e) => e.uid?.startsWith("g-")));
  check("expired Google sign-in: TeamSnap still fine", !s2!.schedule!.feeds!.find((f) => f.kind === "teamsnap")!.lastError);

  // Sign out
  const out = await svc.disconnect("u1", p.id, "teamsnap");
  const after = (await profiles.getById("u1", p.id))!;
  check("sign out: TeamSnap feeds and games removed", out.ok && !after.schedule!.feeds!.some((f) => f.kind === "teamsnap") && !after.schedule!.events.some((e) => e.uid?.startsWith("ts-")));
  check("sign out: token deleted", !(await records.get("integration", `${p.id}:teamsnap`)));
  check("sign out: other sources untouched", after.schedule!.feeds!.some((f) => f.kind === "google") && after.schedule!.feeds!.some((f) => f.app === "sportsengine"));
  check("choose after sign out: asks to sign in", !(await svc.choose("u1", p.id, "teamsnap", [{ id: "501", name: "x" }])).ok);

  // Not configured
  delete process.env.TEAMSNAP_CLIENT_ID;
  const nc = await svc.start("u1", p.id, "teamsnap");
  check("no TeamSnap keys: clear message, suggests the link", !nc.ok && nc.code === "not_configured" && /link/i.test(nc.message || ""));

  console.log(`\nConnect tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
