/**
 * Tests: clubs, roles, medical roster, concussion log and trainer clearance,
 * certifications, dashboard, fields, team hub (challenges, homework, sign-ups,
 * announcements, team calendar), Stripe webhook, dietitians, camps, referrals.
 * Run: npx tsx scripts/club-test.ts
 */

import { createHmac } from "node:crypto";
import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteCheckInRepository, SqliteRecordRepository, SqliteTeamRepository } from "../src/data/sqliteRepository.js";
import type { ProfileInput } from "../src/domain/profile.js";
import { certReport, certStatus, matchCamps, miles } from "../src/domain/club.js";
import { FamilyService } from "../src/services/familyService.js";
import { ClubService, clubActive } from "../src/services/clubService.js";
import { TeamHubService } from "../src/services/teamHubService.js";
import { TeamService } from "../src/services/teamService.js";
import { BillingService, verifyStripeSignature } from "../src/services/billingService.js";
import { MarketService } from "../src/services/marketService.js";
import { MemoryMailer } from "../src/services/notifier.js";
import { StaticProvider } from "../src/weather/nws.js";
import { zipToLatLon } from "../src/weather/nws.js";
import { addDays } from "../src/domain/dates.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
const TODAY = new Date().toISOString().slice(0, 10);
function input(name: string, dob: string, over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    timezone: "America/New_York",
    identity: { fullName: name, dateOfBirth: dob, sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 160, bodyMassKg: 50 },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] },
    routine: { homeZip: "07039" },
    ...over,
  } as ProfileInput;
}

console.log("\nCertifications and camps (pure)");
{
  check("SafeSport valid 1 year", certStatus({ type: "safesport", completed: "2026-01-10" }, "2026-06-01").status === "ok" && certStatus({ type: "safesport", completed: "2025-01-10" }, "2026-06-01").status === "expired");
  check("expiring within 30 days", certStatus({ type: "cpr_first_aid", completed: "2024-06-20" }, "2026-06-01").status === "expiring");
  const rep = certReport({ clubId: "c", userId: "u", role: "coach", certs: [{ type: "safesport", completed: "2026-01-01" }] }, "2026-06-01");
  check("coach missing background, concussion, CPR", rep.missing.length === 3);
  check("miles Livingston to Princeton about 35-45", (() => { const m = miles(zipToLatLon("07039")!, zipToLatLon("08540")!); return m > 30 && m < 50; })());
  const p = { identity: { fullName: "A", dateOfBirth: "2012-01-01", sex: "male" }, sport: { positions: ["goalkeeper"] }, routine: { homeZip: "07039" } } as any;
  const camps = matchCamps(p, [
    { id: "1", title: "Keeper camp", org: "X", start: addDays(TODAY, 30), zip: "07052", ageMin: 10, ageMax: 16, positions: ["goalkeeper"] },
    { id: "2", title: "U8 fun", org: "X", start: addDays(TODAY, 30), zip: "07052", ageMin: 6, ageMax: 8 },
    { id: "3", title: "Far away", org: "X", start: addDays(TODAY, 30), zip: "90210", ageMin: 10, ageMax: 16 },
    { id: "4", title: "Field players", org: "X", start: addDays(TODAY, 10), zip: "07039", ageMin: 10, ageMax: 16, positions: ["forward"] },
  ], TODAY, zipToLatLon);
  check("camps: age and distance filter, keeper match first", camps.length === 2 && camps[0].id === "1");
}

const db = openDatabase(":memory:");
const profiles = new SqliteAthleteProfileRepository(db), checkins = new SqliteCheckInRepository(db), records = new SqliteRecordRepository(db), teamsRepo = new SqliteTeamRepository(db);
const mailer = new MemoryMailer();
const family = new FamilyService(profiles, records);
const hot = new StaticProvider({ "07039": { zip: "07039", timeZone: "America/New_York", place: "Livingston", hours: Array.from({ length: 24 }, (_, h) => ({ time: `${TODAY}T${String(h).padStart(2, "0")}:00`, tempF: 96, feelsF: 104, humidity: 60, wbgtF: 89, windMph: 5, precipPct: 10, thunderPct: 50 })), alerts: [] } });
const clubs = new ClubService(profiles, checkins, teamsRepo, records, mailer, hot);
const hub = new TeamHubService(profiles, checkins, teamsRepo, records, family, clubs, async () => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:g1\nSUMMARY:Game vs Lions\nDTSTART:${addDays(TODAY, 3).replace(/-/g, "")}T140000Z\nLOCATION:Field, NJ 07052\nEND:VEVENT\nEND:VCALENDAR`);
const teamSvc = new TeamService(teamsRepo, profiles, checkins, family, mailer);

console.log("\nClubs and roles");
const c = await clubs.create("dir", "dir@club.com", "Livingston SC");
check("club created with 30-day trial", c.ok && c.value.plan === "trial" && clubActive(c.value));
const clubId = c.ok ? c.value.id : "";
const ref = c.ok ? c.value.referralCode : "";
const c2 = await clubs.create("dir2", "d2@x.com", "Other FC", ref);
check("referral: new club gets 60-day trial, referrer earns a free month", c2.ok && (Date.parse(c2.value.trialEnds!) - Date.parse(TODAY)) / 86_400_000 >= 59 && (await clubs.club(clubId))!.freeMonths === 1);
check("bad referral code rejected", !(await clubs.create("x", undefined, "Nope", "ZZZZZZZZ")).ok);
const invC = await clubs.invite("dir", clubId, "coach");
const invT = await clubs.invite("dir", clubId, "trainer");
check("only directors invite", !(await clubs.invite("stranger", clubId, "coach")).ok);
await clubs.join("coach1", "coach@club.com", invC.ok ? invC.value.code : "", "Coach Kim");
await clubs.join("atc", "atc@club.com", invT.ok ? invT.value.code : "", "Pat Lee, ATC");
check("invite single-use", !(await clubs.join("x", "x@x.com", invC.ok ? invC.value.code : "")).ok);
const team = await clubs.addTeam("coach1", clubId, { name: "U12 Blue", ageGroup: "U12" });
check("coach creates a club team", team.ok);
const teamId = team.ok ? team.value.id : "";

// Players join the team.
const p1 = await profiles.create("fam1", input("Ana Diaz", "2014-03-01", { contact: { parentEmail: "fam1@x.com", emergencyContact: { name: "Mom", phone: "973-555-0101" } }, nutrition: { allergies: [{ allergen: "peanut", severity: "severe", epinephrine: true }], dietaryRestrictions: [], intolerances: [], dislikes: [], medicalDiets: ["low_fodmap"] }, health: { injuryHistory: [], currentInjuries: [], medicalConditions: ["ADHD"], medications: ["x"], asthma: { has: true }, concussions: [{ id: "k1", date: addDays(TODAY, -6), step: 4, stepHistory: [{ step: 0, date: addDays(TODAY, -6) }, { step: 4, date: addDays(TODAY, -1) }] }] } }));
const p2 = await profiles.create("fam2", input("Ben Cole", "2014-05-01"));
const tm = await teamsRepo.getById(teamId);
await teamSvc.join("fam1", p1.id, tm!.code);
await teamSvc.join("fam2", p2.id, tm!.code);
await checkins.upsert("fam1", { profileId: p1.id, date: TODAY, sleepHoursLastNight: 9, urineColor: 2, warmupDone: true });
await checkins.upsert("fam2", { profileId: p2.id, date: TODAY, sleepHoursLastNight: 7 });
await checkins.upsert("fam2", { profileId: p2.id, date: addDays(TODAY, -1), sleepHoursLastNight: 7, urineColor: 2 });

console.log("\nMedical roster, concussion log, clearance");
{
  const dirView = await clubs.medicalRoster("dir", clubId);
  const atcView = await clubs.medicalRoster("atc", clubId);
  const coachView = await clubs.medicalRoster("coach1", clubId);
  const ana = (v: typeof dirView) => (v.ok ? v.value.rows.find((r) => r.name === "Ana Diaz") : undefined);
  check("director: allergies, EpiPen, asthma, emergency contact", !!ana(dirView)?.epinephrine && ana(dirView)!.asthma && ana(dirView)!.emergency?.phone === "973-555-0101");
  check("director: no conditions or medications", ana(dirView)!.conditions === undefined && ana(dirView)!.medications === undefined && !ana(dirView)!.medicalDiets.includes("low_fodmap"));
  check("trainer: full medical view", ana(atcView)!.conditions?.includes("ADHD") === true && ana(atcView)!.medicalDiets.includes("low_fodmap"));
  check("coaches can't open the club medical roster", !coachView.ok);
  const log = await clubs.concussionLog("atc", clubId);
  check("concussion log lists open case first", log.ok && log.value[0].name === "Ana Diaz" && !log.value[0].clearedAt);
  const dirLog = await clubs.concussionLog("dir", clubId);
  check("director log hides step history", dirLog.ok && dirLog.value[0].history === undefined);
  check("coach can't clear", !(await clubs.trainerClear("coach1", clubId, p1.id, TODAY)).ok);
  const clr = await clubs.trainerClear("atc", clubId, p1.id, TODAY);
  const after = await profiles.getById("fam1", p1.id);
  check("trainer clears with name recorded", clr.ok && after!.health!.concussions![0].clearedAt === TODAY && /Pat Lee/.test(after!.health!.concussions![0].clearedBy!));
}

console.log("\nStaff, dashboard, fields");
{
  await clubs.updateMe("coach1", clubId, { phone: "973-555-0300", certs: [{ type: "safesport", completed: addDays(TODAY, -400) }] });
  const st = await clubs.staffList("dir", clubId, TODAY);
  const kim = st.ok ? st.value.find((s) => s.name === "Coach Kim") : undefined;
  check("director sees expired SafeSport for a coach", !!kim && kim.certReport!.expired.some((e) => e.type === "safesport"));
  const stCoach = await clubs.staffList("coach1", clubId, TODAY);
  check("coaches don't see other staff's certs or emails", stCoach.ok && stCoach.value.filter((s) => s.userId !== "coach1").every((s) => s.certs === undefined && s.email === undefined));
  check("coach can't go on call; trainer can", !(await clubs.updateMe("coach1", clubId, { onCall: { active: true } })).ok && (await clubs.updateMe("atc", clubId, { phone: "973-555-0400", onCall: { active: true, location: "Field 3 tent" } })).ok);
  const f = await clubs.setField("dir", clubId, { name: "Riker Hill", zip: "07039" });
  check("director adds a field", f.ok && f.value.length === 1);
  const fid = f.ok ? f.value[0].id : "";
  const closed = await clubs.setField("coach1", clubId, { id: fid, status: "closed", note: "Wet grass" });
  check("coach closes a field; staff emailed; team announcement posted", closed.ok && mailer.sent.some((m) => /Riker Hill closed/.test(m.subject)) && (await records.listByKey("announce", teamId)).length === 1);
  const d = await clubs.dashboard("dir", clubId, TODAY);
  check("dashboard: team check-in rate, field heat, on-call trainer", d.ok && d.value.teams[0].players === 2 && d.value.teams[0].checkinRate7d > 0 && d.value.fields[0].severity !== "none" && d.value.onCall.length === 1);
  const sent = await clubs.sendFieldAlerts(TODAY);
  const again = await clubs.sendFieldAlerts(TODAY);
  check("heat/storm alert emailed once per day", sent === 1 && again === 0 && mailer.sent.some((m) => /weather alert/.test(m.subject)));
  const fam = await clubs.forProfile("fam1", p1.id);
  check("families see branding, on-call trainer, field closure", fam.length === 1 && fam[0].onCall[0].phone === "973-555-0400" && fam[0].fields[0].status === "closed");
  await clubs.update("dir", clubId, { primary: "#0a3d91", accent: "#ffcc00", sponsor: { name: "Livingston Bagels", url: "https://example.com" } });
  check("branding and sponsor saved", (await clubs.forProfile("fam1", p1.id))[0].brand?.primary === "#0a3d91" && (await clubs.forProfile("fam1", p1.id))[0].sponsor?.name === "Livingston Bagels");
  check("bad color rejected", !(await clubs.update("dir", clubId, { primary: "red" })).ok);
}

console.log("\nTeam hub");
{
  check("stranger can't see the hub", !(await hub.hub("stranger", teamId, TODAY)).ok);
  const ch = await hub.createChallenge("coach1", teamId, { type: "hydration", start: addDays(TODAY, -1), end: TODAY });
  check("coach starts a challenge; families can't", ch.ok && !(await hub.createChallenge("fam1", teamId, { type: "sleep", start: TODAY, end: TODAY })).ok);
  const h = await hub.hub("fam1", teamId, TODAY);
  const v = h.ok ? (h.value as any) : null;
  check("family sees leaderboard with first name + initial, no join code", v && v.challenges[0].board.rows[0].name.match(/^[A-Z][a-z]+ [A-Z]\.$/) && v.team.code === undefined);
  const w = await hub.announceWinners("coach1", teamId, ch.ok ? ch.value.id : "", "Great job!");
  check("winners announced (tie: both had 1 hydrated day)", w.ok && w.value.winners!.length === 2);
  const hw = await hub.createHomework("coach1", teamId, { title: "Wall passes", minutes: 10, videoUrl: "https://youtu.be/abc" });
  check("homework needs https video link", !(await hub.createHomework("coach1", teamId, { title: "x", videoUrl: "javascript:alert(1)" })).ok);
  const done = await hub.completeHomework("fam1", teamId, hw.ok ? hw.value.id : "", { profileId: p1.id, date: TODAY });
  check("family logs homework for own player only", done.ok && !(await hub.completeHomework("fam1", teamId, hw.ok ? hw.value.id : "", { profileId: p2.id, date: TODAY })).ok);
  const su = await hub.createSignup("fam2", teamId, { kind: "snack", date: addDays(TODAY, 2), slots: 1 });
  const take = await hub.takeSlot("fam1", teamId, su.ok ? su.value.id : "", { name: "Ana's mom" });
  const full = await hub.takeSlot("fam2", teamId, su.ok ? su.value.id : "", { name: "Ben's dad" });
  check("snack sign-up: one spot, second person told it's full", take.ok && !full.ok);
  const h2 = await hub.hub("coach1", teamId, TODAY);
  const v2 = h2.ok ? (h2.value as any) : null;
  check("coach hub: homework done count, snack ideas safe for peanut allergy", v2.homework[0].doneCount === 1 && v2.snackIdeas.halftime.length > 0 && !/peanut/i.test(JSON.stringify(v2.snackIdeas)));
  const feed = await hub.setFeed("coach1", teamId, "webcal://example.com/team.ics");
  const ben = await profiles.getById("fam2", p2.id);
  check("team calendar pushes games to every player", feed.ok && feed.value.count === 1 && ben!.schedule!.events.some((e) => e.title === "Game vs Lions" && e.source === `team:${teamId}` && e.zip === "07052"));
  await hub.syncFeed(teamId);
  check("re-sync doesn't duplicate", (await profiles.getById("fam2", p2.id))!.schedule!.events.filter((e) => e.source === `team:${teamId}`).length === 1);
  check("families can't set the team calendar", !(await hub.setFeed("fam1", teamId, "webcal://example.com/x.ics")).ok);
}

console.log("\nStripe");
{
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { client_reference_id: clubId, customer: "cus_1", subscription: "sub_1", metadata: { clubId } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  check("signature verified", verifyStripeSignature(body, `t=${t},v1=${sig}`, secret));
  check("tampered body rejected", !verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret));
  check("old timestamp rejected", !verifyStripeSignature(body, `t=${t - 1000},v1=${createHmac("sha256", secret).update(`${t - 1000}.${body}`).digest("hex")}`, secret));
  const billing = new BillingService(clubs, records);
  const r1 = await billing.handleEvent(JSON.parse(body));
  const r2 = await billing.handleEvent(JSON.parse(body));
  check("checkout activates club once", r1 === "activated" && r2 === "duplicate" && (await clubs.club(clubId))!.plan === "active");
  await billing.handleEvent({ id: "evt_2", type: "customer.subscription.deleted", data: { object: { metadata: { clubId } } } });
  const fp = await clubs.forProfile("fam1", p1.id);
  check("cancel", (await clubs.club(clubId))!.plan === "canceled" && fp[0]?.brand === null);
  const noKey = await billing.checkout("dir", clubId, 40);
  check("checkout without Stripe keys says not configured", !noKey.ok && noKey.code === "not_configured");
}

console.log("\nDietitians and camps");
{
  const market = new MarketService(profiles, family, records, clubs, mailer);
  check("non-RD can't list", !(await market.apply("rd0", "x@x.com", { name: "Coach Bob", credentials: "Personal trainer" })).ok);
  const app = await market.apply("rd1", "rd@x.com", { name: "Dana Ruiz", credentials: "MS, RDN, CSSD", states: ["NJ", "NY"], bookingUrl: "https://calendly.com/dana" });
  check("pending until approved", app.ok && (await market.list("NJ")).length === 0);
  await market.review(app.ok ? app.value.id : "", "approved");
  const list = await market.list("NJ");
  check("approved dietitian listed without email", list.length === 1 && !("email" in list[0]));
  const req = await market.requestBooking("fam1", "fam1@x.com", { dietitianId: list[0].id, profileId: p1.id, message: "Help with tournament fueling" });
  const mail = mailer.sent.find((m) => m.to.includes("rd@x.com"));
  check("request emailed; no allergy or medical details in it", req.ok && !!mail && !/peanut|ADHD|asthma/i.test(mail.text));
  check("stranger can't request for someone else's player", !(await market.requestBooking("stranger", "s@x.com", { dietitianId: list[0].id, profileId: p1.id })).ok);
  const campInactive = await market.addCamp("dir", { clubId, title: "Fall ID clinic", org: "Livingston SC", zip: "07039", start: addDays(TODAY, 20), ageMin: 10, ageMax: 14 });
  check("posting camps needs an active plan (club was canceled)", !campInactive.ok && campInactive.code === "inactive");
  const pub = await market.addCamp("admin", { title: "Keeper academy", org: "NJ Keepers", zip: "07052", start: addDays(TODAY, 15), ageMin: 10, ageMax: 16 }, true);
  const camps = await market.campsFor("fam1", p1.id, TODAY, [clubId]);
  check("public camp matched for a 12-year-old nearby", pub.ok && camps!.length === 1 && camps![0].distance !== null);
}

console.log(`\nClub tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
