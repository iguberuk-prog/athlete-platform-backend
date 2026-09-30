/**
 * Team hub: announcements, challenges, skills homework, carpool and snack
 * sign-ups, and the team calendar feed.
 *
 * Who can do what on a team:
 *   coach     the team's coach, or a director/coach/trainer of the club that owns it
 *   member    anyone who owns (or is family-linked to) a player on the roster
 * Coach safeguard: there is no private coach-to-player messaging. Everything
 * here is visible to the whole team and its parents.
 *
 * Stored in app_records by team id: announce, challenge, homework, signup,
 * teamfeed; homework_done by profile id.
 */

import { randomUUID } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository, TeamRepository } from "../data/repository.js";
import type { AthleteProfile, ProfileInput, ScheduledEvent } from "../domain/profile.js";
import { CHALLENGE_TYPES, challengeBoard, firstAndInitial, type Challenge, type ChallengeType } from "../domain/club.js";
import { sleepHoursFor } from "../domain/ageBands.js";
import { shortDate } from "../domain/dates.js";
import { featuresFor } from "../domain/features.js";
import { effectiveAge } from "../domain/profile.js";
import { teamMenu } from "../domain/teamMeal.js";
import { parseIcs, toScheduled } from "../domain/ics.js";
import { normalizeFeedUrl } from "./calendarService.js";
import type { FamilyService } from "./familyService.js";
import type { ClubService } from "./clubService.js";
import { fetchFeed } from "./calendarService.js";

export type HResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "forbidden" | "invalid"; message?: string };

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

interface Homework { id: string; teamId: string; title: string; description?: string; videoUrl?: string; minutes?: number; due?: string; createdAt: string }
interface HomeworkDone { homeworkId: string; teamId: string; profileId: string; date: string; note?: string; videoUrl?: string }
interface Signup { id: string; teamId: string; kind: "carpool" | "snack" | "volunteer"; title: string; date: string; time?: string; slots: number; takenBy: { userId: string; name: string; note?: string }[]; createdAt: string }
interface Announce { text: string; by: string; createdAt: string }
interface Kitchen { id: string; teamId: string; title: string; recipe?: string; end: string; createdAt: string }
interface KitchenEntry { profileId: string; name: string; photo: string; caption?: string; votes: string[]; createdAt: string }

const safeUrl = (u: unknown) => (typeof u === "string" && /^https:\/\/[^\s]{4,500}$/.test(u) ? u : undefined);

export class TeamHubService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly teams: TeamRepository,
    private readonly records: RecordRepository,
    private readonly family: FamilyService,
    private readonly clubs: ClubService,
    private readonly fetcher: (url: string) => Promise<string> = fetchFeed,
  ) {}

  /** "coach", "member" (with the user's player ids on this team), or null. */
  async access(userId: string, teamId: string): Promise<{ role: "coach" | "member"; myPlayers: string[] } | null> {
    const team = await this.teams.getById(teamId);
    if (!team) return null;
    if (team.coachOwnerId === userId) return { role: "coach", myPlayers: [] };
    const club = await this.clubs.clubForTeam(teamId);
    if (club && (await this.clubs.staff(club.id, userId))) return { role: "coach", myPlayers: [] };
    const mine: string[] = [];
    for (const m of await this.teams.listMembers(teamId)) if (await this.family.ownerFor(userId, m.profileId)) mine.push(m.profileId);
    return mine.length ? { role: "member", myPlayers: mine } : null;
  }

  private async roster(teamId: string): Promise<{ ownerId: string; p: AthleteProfile }[]> {
    const out = [];
    for (const m of await this.teams.listMembers(teamId)) { const p = await this.profiles.getById(m.ownerId, m.profileId); if (p) out.push({ ownerId: m.ownerId, p }); }
    return out;
  }

  /** Everything the team screen needs in one call. */
  async hub(userId: string, teamId: string, today: string): Promise<HResult<unknown>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "not_found" };
    const team = (await this.teams.getById(teamId))!;
    const kitchens = (await this.records.listByKey<Kitchen>("kitchen", teamId)).map((k) => k.data).filter((k) => k.end >= addDaysStr(today, -7));
    const kitchen = await Promise.all(kitchens.map(async (k) => {
      const es = (await this.records.listByKey<KitchenEntry>("kitchen_entry", k.id)).map((e) => e.data);
      const lead = [...es].sort((x, y) => y.votes.length - x.votes.length)[0];
      return { ...k, entries: es.length, leader: lead && lead.votes.length ? lead.name : null, open: k.end >= today };
    }));
    const [ann, chs, hws, sus, feed] = await Promise.all([
      this.records.listByKey<Announce>("announce", teamId), this.records.listByKey<Challenge>("challenge", teamId),
      this.records.listByKey<Homework>("homework", teamId), this.records.listByKey<Signup>("signup", teamId),
      this.records.get<{ url: string; lastSyncedAt?: string; lastError?: string; count?: number }>("teamfeed", teamId),
    ]);
    const roster = await this.roster(teamId);
    const withCis = await Promise.all(roster.map(async (r) => ({ name: r.p.identity.fullName, p: r.p, checkins: await this.checkins.listByProfile(r.ownerId, r.p.id, 60) })));
    const challenges = chs.map((c) => c.data).filter((c) => c.end >= addDaysStr(today, -14)).sort((x, y) => y.start.localeCompare(x.start)).map((c) => ({
      ...c, board: challengeBoard(c, withCis, (p) => sleepHoursFor(effectiveAge(p.identity))[0]), live: c.start <= today && c.end >= today,
    }));
    const doneRecs = (await Promise.all(roster.map((r) => this.records.listByKey<HomeworkDone>("homework_done", r.p.id)))).flat().map((d) => d.data).filter((d) => d.teamId === teamId);
    const homework = hws.map((h) => h.data).filter((h) => !h.due || h.due >= addDaysStr(today, -7)).sort((x, y) => (y.due || y.createdAt).localeCompare(x.due || x.createdAt)).map((h) => {
      const done = doneRecs.filter((d) => d.homeworkId === h.id);
      return {
        ...h,
        doneCount: new Set(done.map((d) => d.profileId)).size,
        doneByMine: a.myPlayers.filter((pid) => done.some((d) => d.profileId === pid)),
        doneBy: a.role === "coach" ? done.map((d) => ({ name: firstAndInitial(roster.find((r) => r.p.id === d.profileId)?.p.identity.fullName || ""), date: d.date, note: d.note, videoUrl: d.videoUrl })) : undefined,
      };
    });
    const signups = sus.map((s) => s.data).filter((s) => s.date >= today).sort((x, y) => x.date.localeCompare(y.date)).map((s) => ({ ...s, mine: s.takenBy.some((t) => t.userId === userId), takenBy: s.takenBy.map((t) => ({ name: t.name, note: t.note, me: t.userId === userId })) }));
    const snack = teamMenu(roster.map((r) => r.p), { gameDay: true });
    return {
      ok: true,
      value: {
        team: { id: team.id, name: team.name, code: a.role === "coach" ? team.code : undefined, players: roster.length },
        role: a.role,
        announcements: ann.map((x) => ({ id: x.id, ...x.data })).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 20),
        challenges, homework, signups, kitchen,
        snackIdeas: { halftime: snack.sections.find((s) => s.title === "Half-time snacks")?.forEveryone || [], after: snack.sections.find((s) => s.title === "After-game snacks")?.forEveryone || [], tips: snack.tips },
        feed: a.role === "coach" ? feed?.data || null : feed ? { connected: true } : null,
      },
    };
  }

  // --- announcements ---------------------------------------------------------------

  async announce(userId: string, teamId: string, text: string, by: string): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    const t = clean(text, 500);
    if (!t) return { ok: false, code: "invalid", message: "Write something first." };
    await this.records.put<Announce>({ id: randomUUID(), kind: "announce", key: teamId, ownerId: userId, data: { text: t, by: clean(by, 40) || "Coach", createdAt: new Date().toISOString() } });
    return { ok: true, value: true };
  }

  async deleteAnnouncement(userId: string, teamId: string, id: string): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    const r = await this.records.get("announce", id);
    if (!r || r.key !== teamId) return { ok: false, code: "not_found" };
    await this.records.delete("announce", id);
    return { ok: true, value: true };
  }

  // --- challenges --------------------------------------------------------------------

  async createChallenge(userId: string, teamId: string, b: { type: ChallengeType; start: string; end: string; title?: string }): Promise<HResult<Challenge>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    if (!CHALLENGE_TYPES.includes(b.type) || !isDay(b.start) || !isDay(b.end) || b.end < b.start) return { ok: false, code: "invalid", message: "Pick a challenge type and a start and end date." };
    if ((Date.parse(b.end) - Date.parse(b.start)) / 86_400_000 > 60) return { ok: false, code: "invalid", message: "Challenges run up to 60 days." };
    const ch: Challenge = { id: randomUUID(), teamId, type: b.type, title: clean(b.title, 60) || defaultTitle(b.type), start: b.start, end: b.end, createdAt: new Date().toISOString() };
    await this.records.put({ id: ch.id, kind: "challenge", key: teamId, ownerId: userId, data: ch });
    await this.announce(userId, teamId, `New team challenge: ${ch.title}, ${shortDate(ch.start)} to ${shortDate(ch.end)}. Check in every day to count.`, "Coach");
    return { ok: true, value: ch };
  }

  /** The coach names the winners; it goes out as an announcement. */
  async announceWinners(userId: string, teamId: string, challengeId: string, message?: string): Promise<HResult<Challenge>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    const rec = await this.records.get<Challenge>("challenge", challengeId);
    if (!rec || rec.key !== teamId) return { ok: false, code: "not_found" };
    const roster = await this.roster(teamId);
    const withCis = await Promise.all(roster.map(async (r) => ({ name: r.p.identity.fullName, p: r.p, checkins: await this.checkins.listByProfile(r.ownerId, r.p.id, 90) })));
    const board = challengeBoard(rec.data, withCis, (p) => sleepHoursFor(effectiveAge(p.identity))[0]);
    const top = board.rows.length ? board.rows[0].score : 0;
    const winners = top > 0 ? board.rows.filter((r) => r.score === top).map((r) => r.name) : [];
    const ch = { ...rec.data, winners, announcement: clean(message, 300) || undefined };
    await this.records.put({ id: ch.id, kind: "challenge", key: teamId, ownerId: rec.ownerId, data: ch });
    await this.announce(userId, teamId, `${ch.title} results: ${winners.length ? `Winner${winners.length > 1 ? "s" : ""}: ${winners.join(", ")}!` : "No winner this time."} Team score ${board.teamPct}%.${ch.announcement ? " " + ch.announcement : ""}`, "Coach");
    return { ok: true, value: ch };
  }

  // --- skills homework --------------------------------------------------------------

  async createHomework(userId: string, teamId: string, b: { title: string; description?: string; videoUrl?: string; minutes?: number; due?: string }): Promise<HResult<Homework>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    const title = clean(b.title, 80);
    if (!title) return { ok: false, code: "invalid", message: "Give the drill a name." };
    if (b.videoUrl && !safeUrl(b.videoUrl)) return { ok: false, code: "invalid", message: "Video link must start with https://." };
    if (b.due && !isDay(b.due)) return { ok: false, code: "invalid", message: "Due date must be a date." };
    const h: Homework = { id: randomUUID(), teamId, title, description: clean(b.description, 800) || undefined, videoUrl: safeUrl(b.videoUrl), minutes: Number.isInteger(b.minutes) && b.minutes! > 0 && b.minutes! <= 120 ? b.minutes : undefined, due: b.due, createdAt: new Date().toISOString() };
    await this.records.put({ id: h.id, kind: "homework", key: teamId, ownerId: userId, data: h });
    return { ok: true, value: h };
  }

  async completeHomework(userId: string, teamId: string, homeworkId: string, b: { profileId: string; date: string; note?: string; videoUrl?: string }): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    if (!a || !a.myPlayers.includes(b.profileId)) return { ok: false, code: "forbidden" };
    const hw = await this.records.get<Homework>("homework", homeworkId);
    if (!hw || hw.key !== teamId) return { ok: false, code: "not_found" };
    if (!isDay(b.date)) return { ok: false, code: "invalid", message: "Bad date." };
    if (b.videoUrl && !safeUrl(b.videoUrl)) return { ok: false, code: "invalid", message: "Video link must start with https://." };
    const owner = (await this.family.ownerFor(userId, b.profileId))!;
    await this.records.put<HomeworkDone>({ id: `${homeworkId}:${b.profileId}:${b.date}`, kind: "homework_done", key: b.profileId, ownerId: owner, data: { homeworkId, teamId, profileId: b.profileId, date: b.date, note: clean(b.note, 200) || undefined, videoUrl: safeUrl(b.videoUrl) } });
    return { ok: true, value: true };
  }

  // --- carpool and snack sign-ups -----------------------------------------------------

  async createSignup(userId: string, teamId: string, b: { kind: Signup["kind"]; title?: string; date: string; time?: string; slots: number }): Promise<HResult<Signup>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "forbidden" };
    if (!["carpool", "snack", "volunteer"].includes(b.kind) || !isDay(b.date) || !(Number.isInteger(b.slots) && b.slots >= 1 && b.slots <= 20)) return { ok: false, code: "invalid", message: "Pick a type, a date and 1 to 20 spots." };
    const s: Signup = { id: randomUUID(), teamId, kind: b.kind, title: clean(b.title, 80) || (b.kind === "snack" ? "Game snacks" : b.kind === "carpool" ? "Carpool" : "Volunteer"), date: b.date, time: b.time && /^\d{2}:\d{2}$/.test(b.time) ? b.time : undefined, slots: b.slots, takenBy: [], createdAt: new Date().toISOString() };
    await this.records.put({ id: s.id, kind: "signup", key: teamId, ownerId: userId, data: s });
    return { ok: true, value: s };
  }

  async takeSlot(userId: string, teamId: string, signupId: string, b: { name: string; note?: string; release?: boolean }): Promise<HResult<Signup>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "forbidden" };
    const rec = await this.records.get<Signup>("signup", signupId);
    if (!rec || rec.key !== teamId) return { ok: false, code: "not_found" };
    const s = { ...rec.data };
    if (b.release) s.takenBy = s.takenBy.filter((t) => t.userId !== userId);
    else {
      if (s.takenBy.some((t) => t.userId === userId)) return { ok: false, code: "invalid", message: "You're already signed up." };
      if (s.takenBy.length >= s.slots) return { ok: false, code: "invalid", message: "All spots are taken." };
      const name = clean(b.name, 40);
      if (!name) return { ok: false, code: "invalid", message: "Add your name." };
      s.takenBy = [...s.takenBy, { userId, name, note: clean(b.note, 120) || undefined }];
    }
    await this.records.put({ id: s.id, kind: "signup", key: teamId, ownerId: rec.ownerId, data: s });
    return { ok: true, value: s };
  }

  // --- kitchen challenge (13+): cook the same recipe, post a photo, team votes ---------

  async createKitchen(userId: string, teamId: string, b: { title?: string; recipe?: string; end: string }): Promise<HResult<Kitchen>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "forbidden" };
    if (!isDay(b.end)) return { ok: false, code: "invalid", message: "Pick an end date." };
    const title = clean(b.title, 60) || clean(b.recipe, 60);
    if (!title) return { ok: false, code: "invalid", message: "Name the dish everyone will cook." };
    const k: Kitchen = { id: randomUUID(), teamId, title, recipe: clean(b.recipe, 80) || undefined, end: b.end, createdAt: new Date().toISOString() };
    await this.records.put({ id: k.id, kind: "kitchen", key: teamId, ownerId: userId, data: k });
    await this.records.put<Announce>({ id: randomUUID(), kind: "announce", key: teamId, ownerId: userId, data: { text: `Kitchen challenge: cook "${k.title}" by ${shortDate(k.end)}, post a photo of your plate, and vote for the best one.`, by: a.role === "coach" ? "Coach" : "Team", createdAt: new Date().toISOString() } });
    return { ok: true, value: k };
  }

  async enterKitchen(userId: string, teamId: string, kid: string, b: { profileId: string; photo: string; caption?: string }): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    if (!a || !a.myPlayers.includes(b.profileId)) return { ok: false, code: "forbidden" };
    const k = await this.records.get<Kitchen>("kitchen", kid);
    if (!k || k.key !== teamId) return { ok: false, code: "not_found" };
    const owner = (await this.family.ownerFor(userId, b.profileId))!;
    const p = await this.profiles.getById(owner, b.profileId);
    if (!p || !featuresFor(p).on.kitchenChallenge) return { ok: false, code: "invalid", message: "Kitchen challenges are for players 13 and up." };
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo || "") || b.photo.length > 350_000) return { ok: false, code: "invalid", message: "Add a photo of your plate (under about 250 KB)." };
    const prev = await this.records.get<KitchenEntry>("kitchen_entry", `${kid}:${b.profileId}`);
    await this.records.put<KitchenEntry>({ id: `${kid}:${b.profileId}`, kind: "kitchen_entry", key: kid, ownerId: owner, data: { profileId: b.profileId, name: firstAndInitial(p.identity.fullName), photo: b.photo, caption: clean(b.caption, 120) || undefined, votes: prev?.data.votes || [], createdAt: new Date().toISOString() } });
    return { ok: true, value: true };
  }

  async kitchenEntries(userId: string, teamId: string, kid: string): Promise<HResult<unknown>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "not_found" };
    const k = await this.records.get<Kitchen>("kitchen", kid);
    if (!k || k.key !== teamId) return { ok: false, code: "not_found" };
    const entries = (await this.records.listByKey<KitchenEntry>("kitchen_entry", kid)).map((e) => ({
      id: e.id, name: e.data.name, photo: e.data.photo, caption: e.data.caption, votes: e.data.votes.length,
      mine: a.myPlayers.includes(e.data.profileId), myVote: e.data.votes.includes(userId),
    })).sort((x, y) => y.votes - x.votes);
    return { ok: true, value: { challenge: k.data, entries, role: a.role, open: k.data.end >= new Date().toISOString().slice(0, 10) } };
  }

  /** One vote per person per challenge; you can move it, but not vote for your own player. */
  async voteKitchen(userId: string, teamId: string, kid: string, entryId: string): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    if (!a) return { ok: false, code: "forbidden" };
    const entries = await this.records.listByKey<KitchenEntry>("kitchen_entry", kid);
    const target = entries.find((e) => e.id === entryId);
    if (!target) return { ok: false, code: "not_found" };
    if (a.myPlayers.includes(target.data.profileId)) return { ok: false, code: "invalid", message: "Vote for a teammate's plate." };
    for (const e of entries) {
      const has = e.data.votes.includes(userId);
      const want = e.id === entryId;
      if (has !== want) await this.records.put<KitchenEntry>({ id: e.id, kind: "kitchen_entry", key: kid, ownerId: e.ownerId, data: { ...e.data, votes: want ? [...e.data.votes, userId] : e.data.votes.filter((v) => v !== userId) } });
    }
    return { ok: true, value: true };
  }

  async removeKitchenEntry(userId: string, teamId: string, kid: string, entryId: string): Promise<HResult<true>> {
    const a = await this.access(userId, teamId);
    const e = await this.records.get<KitchenEntry>("kitchen_entry", entryId);
    if (!a || !e || e.key !== kid) return { ok: false, code: "not_found" };
    if (a.role !== "coach" && !a.myPlayers.includes(e.data.profileId)) return { ok: false, code: "forbidden" };
    await this.records.delete("kitchen_entry", entryId);
    return { ok: true, value: true };
  }

  // --- team calendar (coach adds once, every player gets it) ---------------------------------

  async setFeed(userId: string, teamId: string, url: string | null): Promise<HResult<{ count: number; error?: string }>> {
    const a = await this.access(userId, teamId);
    if (!a || a.role !== "coach") return { ok: false, code: "forbidden" };
    if (!url) {
      await this.records.delete("teamfeed", teamId);
      await this.pushEvents(teamId, []);
      return { ok: true, value: { count: 0 } };
    }
    const clean = normalizeFeedUrl(url);
    if (!clean) return { ok: false, code: "invalid", message: "Paste the team calendar's subscribe link." };
    url = clean;
    await this.records.put({ id: teamId, kind: "teamfeed", key: teamId, ownerId: userId, data: { url } });
    return { ok: true, value: await this.syncFeed(teamId) };
  }

  async syncFeed(teamId: string): Promise<{ count: number; error?: string }> {
    const rec = await this.records.get<{ url: string }>("teamfeed", teamId);
    if (!rec) return { count: 0 };
    try {
      const text = await this.fetcher(rec.data.url);
      const now = Date.now();
      const count = await this.pushEvents(teamId, [], (tz) => toScheduled(parseIcs(text, tz, now - 7 * 86_400_000, now + 180 * 86_400_000), `team:${teamId}`, tz));
      await this.records.put({ id: teamId, kind: "teamfeed", key: teamId, ownerId: rec.ownerId, data: { url: rec.data.url, lastSyncedAt: new Date().toISOString(), count } });
      return { count };
    } catch (err) {
      const error = (err as Error).message.slice(0, 200);
      await this.records.put({ id: teamId, kind: "teamfeed", key: teamId, ownerId: rec.ownerId, data: { url: rec.data.url, lastError: error } });
      return { count: 0, error };
    }
  }

  /** Replace this team's feed events on every player's schedule (in each player's time zone). */
  private async pushEvents(teamId: string, fixed: ScheduledEvent[], build?: (tz: string) => ScheduledEvent[]): Promise<number> {
    let count = 0;
    for (const { ownerId, p } of await this.roster(teamId)) {
      const evs = build ? build(p.timezone) : fixed;
      count = evs.length;
      const keep = (p.schedule?.events || []).filter((e) => e.source !== `team:${teamId}`);
      const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = p;
      await this.profiles.update(ownerId, p.id, { ...(rest as ProfileInput), schedule: { ...(p.schedule || { events: [] }), events: [...keep, ...evs.map((e) => ({ ...e, zip: e.zip || p.routine?.homeZip }))] } });
    }
    return count;
  }

  async syncAllFeeds(budgetMs = 10_000): Promise<number> {
    const t0 = Date.now();
    let n = 0;
    for (const f of await this.records.listByKind("teamfeed", 1000)) {
      if (Date.now() - t0 > budgetMs) break;
      await this.syncFeed(f.id).catch(() => null);
      n++;
    }
    return n;
  }
}

const defaultTitle = (t: ChallengeType) => ({ checkin: "Check-in streak", hydration: "Hydration week", sleep: "Sleep challenge", warmup: "Warm-up challenge" }[t]);
function addDaysStr(d: string, n: number) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
