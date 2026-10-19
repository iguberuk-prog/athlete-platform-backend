/**
 * Tests for club-scale features: bulk roster import -> claimable invite links,
 * claim prefill + redeem (auto-join), club-admin roster view, top-down removal,
 * and the batched data-layer reads (findManyByIds, listRecentForProfiles).
 * Run: npx tsx scripts/clubadmin-test.ts
 */

import { openDatabase } from "../src/data/db.js";
import { SqliteAthleteProfileRepository, SqliteCheckInRepository, SqliteRecordRepository, SqliteTeamRepository } from "../src/data/sqliteRepository.js";
import type { ProfileInput } from "../src/domain/profile.js";
import { ClubService } from "../src/services/clubService.js";
import { MemoryMailer } from "../src/services/notifier.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
function input(name: string): ProfileInput {
  return {
    timezone: "America/New_York",
    identity: { fullName: name, dateOfBirth: "2011-05-01", sex: "male" },
    sport: { primarySport: "soccer", positions: ["midfielder"], competitionLevel: "high_school" },
    anthropometrics: { heightCm: 160, bodyMassKg: 50 },
    nutrition: { allergies: [], dietaryRestrictions: [], intolerances: [], dislikes: [] },
  } as ProfileInput;
}

const db = openDatabase(":memory:");
const profiles = new SqliteAthleteProfileRepository(db);
const checkins = new SqliteCheckInRepository(db);
const records = new SqliteRecordRepository(db);
const teamsRepo = new SqliteTeamRepository(db);
const mailer = new MemoryMailer();
const clubs = new ClubService(profiles, checkins, teamsRepo, records, mailer, null);
const APP = "https://app.example.com";

console.log("\nBatched data-layer reads");
{
  const a = await profiles.create("o1", input("Ava"));
  const b = await profiles.create("o2", input("Ben"));
  const c = await profiles.create("o3", input("Cy"));
  const many = await profiles.findManyByIds([a.id, c.id, "missing-id"]);
  check("findManyByIds returns only existing (1 query)", many.length === 2 && many.some((p) => p.id === a.id) && many.some((p) => p.id === c.id));
  check("findManyByIds([]) is empty", (await profiles.findManyByIds([])).length === 0);
  await checkins.upsert("o1", { profileId: a.id, date: "2026-10-10", energyLevel: 7 });
  await checkins.upsert("o1", { profileId: a.id, date: "2026-10-12", energyLevel: 8 });
  await checkins.upsert("o2", { profileId: b.id, date: "2026-10-11", energyLevel: 5 });
  const rec = await checkins.listRecentForProfiles([a.id, b.id, c.id], 1);
  check("listRecentForProfiles caps per profile + newest first", rec.get(a.id)?.length === 1 && rec.get(a.id)?.[0].date === "2026-10-12");
  check("listRecentForProfiles covers each requested profile", rec.get(b.id)?.length === 1 && !rec.has(c.id));
}

console.log("\nBulk roster import + claim/redeem");
const made = await clubs.create("dir", "dir@sta.com", "STA");
const clubId = made.ok ? made.value.id : "";
const imp = await clubs.importRoster("dir", clubId, {
  teamName: "STA U14 Boys",
  ageGroup: "U14",
  rows: [
    { fullName: "Josh Guberuk", parentEmail: "parent1@example.com", dateOfBirth: "2011-03-02" },
    { fullName: "Marco Diaz", parentEmail: "parent2@example.com" },
    { fullName: "No Email Kid" },
    { name: "", parentEmail: "x@example.com" }, // missing name -> error row
  ],
}, APP);
check("import creates a team + 3 athletes, 1 error row", imp.ok && imp.value.created === 3 && imp.value.errors.length === 1);
check("import emails only rows with a parent email", imp.ok && imp.value.emailed === 2 && mailer.sent.length === 2);
check("invite email contains a claim link", mailer.sent[0]?.text.includes(`${APP}/#/join?claim=`));
const teamId = imp.ok ? imp.value.teamId : "";

const token = (await records.listByKey<{ fullName: string; token: string; parentEmail?: string }>("claim", clubId)).find((r) => r.data.fullName === "Josh Guberuk")!.data.token;
const info = await clubs.claimInfo(token);
check("claimInfo prefills name + team (no health data)", info?.fullName === "Josh Guberuk" && info?.teamName === "STA U14 Boys" && !("health" in (info || {})));

const stat1 = await clubs.importStatus("dir", clubId, APP);
check("importStatus: 3 invited, 3 pending, 0 joined", stat1.ok && stat1.value.total === 3 && stat1.value.pending === 3 && stat1.value.joined === 0);
check("director sees a copyable invite link per pending athlete", stat1.ok && stat1.value.rows.every((r) => typeof r.inviteLink === "string" && r.inviteLink!.startsWith(`${APP}/#/join?claim=`)));
{
  const inv = await clubs.invite("dir", clubId, "coach");
  const joined = inv.ok ? await clubs.join("coach1", "coach1@sta.com", inv.value.code, "Coach One") : null;
  const coachView = await clubs.importStatus("coach1", clubId, APP);
  check("coach does not get invite links or parent emails", !!joined?.ok && coachView.ok && coachView.value.rows.every((r) => r.inviteLink === undefined && r.parentEmail === undefined));
}

// A family signs up, creates the athlete's profile, and redeems the token.
const famProfile = await profiles.create("parentAcct", input("Josh Guberuk"));
const redeem = await clubs.redeemClaim("parentAcct", famProfile.id, token);
check("redeemClaim auto-joins the team", redeem.ok && redeem.value.teamName === "STA U14 Boys");
check("member row created for the family account", (await teamsRepo.listMembers(teamId)).some((m) => m.profileId === famProfile.id && m.ownerId === "parentAcct"));
check("re-redeeming the same token is rejected", !(await clubs.redeemClaim("parentAcct", famProfile.id, token)).ok);
check("a bad token is rejected", !(await clubs.redeemClaim("parentAcct", famProfile.id, "NOPE1234")).ok);

const stat2 = await clubs.importStatus("dir", clubId);
check("importStatus flips to 1 joined / 2 pending", stat2.ok && stat2.value.joined === 1 && stat2.value.pending === 2);

console.log("\nClub-admin roster view + removal");
const rv = await clubs.rosterView("dir", clubId);
check("rosterView lists the joined athlete with team + status", rv.ok && rv.value.totalPlayers === 1 && rv.value.rows[0].name === "Josh Guberuk" && rv.value.rows[0].team === "STA U14 Boys");
const rm = await clubs.removePlayer("dir", clubId, teamId, famProfile.id);
check("director removes an athlete top-down", rm.ok);
const afterRemove = await clubs.rosterView("dir", clubId);
check("rosterView empty after removal", afterRemove.ok && afterRemove.value.totalPlayers === 0);

console.log("\nAccess control");
check("a non-staff user cannot import a roster", !(await clubs.importRoster("stranger", clubId, { teamName: "X", rows: [{ fullName: "Z" }] }, APP)).ok);
check("a non-staff user cannot view the club roster", !(await clubs.rosterView("stranger", clubId)).ok);

console.log("\nScale: a large roster loads via batched reads");
{
  const big = await clubs.create("dir2", "dir2@sta.com", "STA Academy");
  const bid = big.ok ? big.value.id : "";
  const team = await clubs.addTeam("dir2", bid, { name: "Academy U16" });
  const tid = team.ok ? team.value.id : "";
  for (let i = 0; i < 60; i++) {
    const p = await profiles.create("acct" + i, input("Player " + i));
    await teamsRepo.addMember({ teamId: tid, profileId: p.id, ownerId: "acct" + i, joinedAt: new Date().toISOString() });
  }
  const rv2 = await clubs.rosterView("dir2", bid);
  check("rosterView returns all 60 players", rv2.ok && rv2.value.totalPlayers === 60);
  const dash = await clubs.dashboard("dir2", bid, new Date().toISOString().slice(0, 10));
  check("dashboard totals reflect 60 players", dash.ok && dash.value.totals.players === 60);
}

db.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
