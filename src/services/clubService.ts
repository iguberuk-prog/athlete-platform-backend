/**
 * Clubs: staff and roles, teams, branding, fields, dashboard, medical roster,
 * concussion log, certifications, trainer on-call, referrals.
 *
 * Stored in app_records:
 *   club        id = clubId,          key "club",   owner = director
 *   clubstaff   id = clubId:userId,   key clubId,   owner = staff user
 *   clubinvite  id = code,            key clubId
 *   clubteam    id = teamId,          key clubId
 *   refcode     id = referral code,   key clubId
 */

import { randomInt, randomUUID } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository, TeamRepository } from "../data/repository.js";
import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import {
  CERT_TYPES, STAFF_ROLES, certReport, isHex, medicalRow, teamHealth,
  type Cert, type Club, type Field, type MedicalRow, type Staff, type StaffRole,
} from "../domain/club.js";
import { weatherPlan, summarize } from "../domain/weather.js";
import { newJoinCode } from "../domain/team.js";
import type { WeatherProvider } from "../weather/nws.js";
import type { Mailer } from "./notifier.js";
import { escHtml } from "./notifier.js";

export type CResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "forbidden" | "invalid" | "inactive"; message?: string };

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = (n = 8) => Array.from({ length: n }, () => ALPHA[randomInt(ALPHA.length)]).join("");
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function clubActive(c: Club, today = new Date().toISOString().slice(0, 10)): boolean {
  return c.plan === "active" || c.plan === "free" || (c.plan === "trial" && !!c.trialEnds && c.trialEnds >= today);
}

export class ClubService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly teams: TeamRepository,
    private readonly records: RecordRepository,
    private readonly mailer: Mailer,
    private readonly weather: WeatherProvider | null,
  ) {}

  // --- access -----------------------------------------------------------------

  async club(id: string): Promise<Club | null> {
    return (await this.records.get<Club>("club", id))?.data ?? null;
  }
  async saveClub(c: Club): Promise<void> {
    await this.records.put({ id: c.id, kind: "club", key: "club", ownerId: c.directorId, data: c });
  }
  async staff(clubId: string, userId: string): Promise<Staff | null> {
    return (await this.records.get<Staff>("clubstaff", `${clubId}:${userId}`))?.data ?? null;
  }
  private async role(clubId: string, userId: string): Promise<StaffRole | null> {
    return (await this.staff(clubId, userId))?.role ?? null;
  }
  private async need(clubId: string, userId: string, roles: StaffRole[]): Promise<CResult<{ club: Club; role: StaffRole }>> {
    const club = await this.club(clubId);
    if (!club) return { ok: false, code: "not_found" };
    const role = await this.role(clubId, userId);
    if (!role || !roles.includes(role)) return { ok: false, code: "forbidden" };
    return { ok: true, value: { club, role } };
  }

  async teamById(teamId: string) { return this.teams.getById(teamId); }

  /** Club that owns a team, if any. */
  async clubForTeam(teamId: string): Promise<Club | null> {
    const link = await this.records.get<{ teamId: string }>("clubteam", teamId);
    return link ? this.club(link.key) : null;
  }

  // --- clubs ------------------------------------------------------------------

  async create(userId: string, email: string | undefined, name: string, referral?: string): Promise<CResult<Club>> {
    const n = clean(name, 80);
    if (!n) return { ok: false, code: "invalid", message: "Club name is required." };
    const today = new Date().toISOString().slice(0, 10);
    let referredBy: string | undefined;
    let trialDays = 30;
    if (referral) {
      const ref = await this.records.get<{ clubId: string }>("refcode", clean(referral, 12).toUpperCase());
      const refClub = ref ? await this.club(ref.key) : null;
      if (!refClub) return { ok: false, code: "invalid", message: "That referral code wasn't found." };
      referredBy = refClub.id;
      trialDays += 30;
      await this.saveClub({ ...refClub, freeMonths: (refClub.freeMonths || 0) + 1 });
    }
    const club: Club = {
      id: randomUUID(), name: n, directorId: userId, plan: "trial",
      trialEnds: new Date(Date.parse(today) + trialDays * 86_400_000).toISOString().slice(0, 10),
      referralCode: code(8), referredBy, fields: [], createdAt: new Date().toISOString(),
    };
    await this.saveClub(club);
    await this.records.put({ id: club.referralCode, kind: "refcode", key: club.id, ownerId: userId, data: { clubId: club.id } });
    await this.records.put<Staff>({ id: `${club.id}:${userId}`, kind: "clubstaff", key: club.id, ownerId: userId, data: { clubId: club.id, userId, role: "director", email, certs: [] } });
    return { ok: true, value: club };
  }

  async mine(userId: string) {
    const st = await this.records.listByOwner<Staff>("clubstaff", userId);
    const out = [];
    for (const s of st) {
      const c = await this.club(s.key);
      if (c) out.push({ club: publicClub(c, s.data.role === "director"), role: s.data.role, active: clubActive(c) });
    }
    return out;
  }

  async get(userId: string, clubId: string) {
    const r = await this.need(clubId, userId, [...STAFF_ROLES]);
    if (!r.ok) return r;
    const teams = await this.clubTeams(clubId);
    return { ok: true as const, value: { club: publicClub(r.value.club, r.value.role === "director"), role: r.value.role, active: clubActive(r.value.club), teams } };
  }

  async update(userId: string, clubId: string, b: Partial<Club>): Promise<CResult<Club>> {
    const r = await this.need(clubId, userId, ["director"]);
    if (!r.ok) return r;
    const c = { ...r.value.club };
    if (b.name !== undefined) c.name = clean(b.name, 80) || c.name;
    if (b.logoUrl !== undefined) {
      if (b.logoUrl && !(typeof b.logoUrl === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(b.logoUrl) && b.logoUrl.length < 200_000)) return { ok: false, code: "invalid", message: "Logo must be a PNG, JPEG or WebP under 150 KB." };
      c.logoUrl = b.logoUrl || undefined;
    }
    for (const k of ["primary", "accent"] as const) if (b[k] !== undefined) {
      if (b[k] && !isHex(b[k])) return { ok: false, code: "invalid", message: "Colors must look like #1a2b3c." };
      c[k] = b[k] || undefined;
    }
    if (b.sponsor !== undefined) {
      const s = b.sponsor;
      if (s && (!clean(s.name, 60) || (s.url && !/^https:\/\//.test(s.url)))) return { ok: false, code: "invalid", message: "Sponsor needs a name, and a link starting with https://." };
      c.sponsor = s ? { name: clean(s.name, 60), url: s.url ? clean(s.url, 300) : undefined, message: s.message ? clean(s.message, 140) : undefined, logoUrl: s.logoUrl && /^data:image\//.test(s.logoUrl) && s.logoUrl.length < 150_000 ? s.logoUrl : undefined } : undefined;
    }
    await this.saveClub(c);
    return { ok: true, value: c };
  }

  // --- staff ------------------------------------------------------------------

  async invite(userId: string, clubId: string, role: StaffRole): Promise<CResult<{ code: string; expiresAt: string }>> {
    const r = await this.need(clubId, userId, ["director"]);
    if (!r.ok) return r;
    if (!STAFF_ROLES.includes(role)) return { ok: false, code: "invalid", message: "Role must be director, coach or trainer." };
    const c = code(8);
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await this.records.put({ id: c, kind: "clubinvite", key: clubId, ownerId: userId, data: { role, expiresAt } });
    return { ok: true, value: { code: c, expiresAt } };
  }

  async join(userId: string, email: string | undefined, raw: string, name?: string): Promise<CResult<{ clubId: string; role: StaffRole; name: string }>> {
    const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const inv = await this.records.get<{ role: StaffRole; expiresAt: string }>("clubinvite", c);
    if (!inv || inv.data.expiresAt < new Date().toISOString()) return { ok: false, code: "invalid", message: "That staff code is wrong or expired. Ask your director for a new one." };
    const club = await this.club(inv.key);
    if (!club) return { ok: false, code: "not_found" };
    const prev = await this.staff(club.id, userId);
    await this.records.put<Staff>({ id: `${club.id}:${userId}`, kind: "clubstaff", key: club.id, ownerId: userId, data: { clubId: club.id, userId, role: prev?.role === "director" ? "director" : inv.data.role, email, name: clean(name, 80) || prev?.name, certs: prev?.certs || [], phone: prev?.phone } });
    await this.records.delete("clubinvite", c);
    return { ok: true, value: { clubId: club.id, role: inv.data.role, name: club.name } };
  }

  async staffList(userId: string, clubId: string, today: string) {
    const r = await this.need(clubId, userId, ["director", "trainer", "coach"]);
    if (!r.ok) return r;
    const list = (await this.records.listByKey<Staff>("clubstaff", clubId)).map((x) => x.data);
    const director = r.value.role === "director";
    return {
      ok: true as const,
      value: list.map((s) => ({
        userId: s.userId, isMe: s.userId === userId, role: s.role, name: s.name, email: director ? s.email : undefined, phone: s.phone,
        onCall: s.onCall, certs: director || s.userId === userId ? s.certs : undefined,
        certReport: director || s.userId === userId ? certReport(s, today) : undefined,
      })),
    };
  }

  /** Staff edit their own contact, certifications and on-call status. */
  async updateMe(userId: string, clubId: string, b: { name?: string; phone?: string; certs?: Cert[]; onCall?: { active: boolean; location?: string; until?: string } }): Promise<CResult<Staff>> {
    const s = await this.staff(clubId, userId);
    if (!s) return { ok: false, code: "forbidden" };
    const next: Staff = { ...s };
    if (b.name !== undefined) next.name = clean(b.name, 80);
    if (b.phone !== undefined) {
      if (b.phone && !/^[\d+()\-. ]{7,20}$/.test(b.phone)) return { ok: false, code: "invalid", message: "Phone number doesn't look right." };
      next.phone = b.phone || undefined;
    }
    if (b.certs !== undefined) {
      if (!Array.isArray(b.certs) || b.certs.length > 30 || !b.certs.every((c) => CERT_TYPES.includes(c.type) && isDay(c.completed) && (c.expires === undefined || isDay(c.expires))))
        return { ok: false, code: "invalid", message: "Each certification needs a type and a completed date." };
      next.certs = b.certs.map((c) => ({ type: c.type, completed: c.completed, expires: c.expires, note: c.note ? clean(c.note, 80) : undefined }));
    }
    if (b.onCall !== undefined) {
      if (s.role !== "trainer" && s.role !== "director") return { ok: false, code: "forbidden", message: "Only trainers go on call." };
      next.onCall = b.onCall.active ? { active: true, location: clean(b.onCall.location, 120) || undefined, until: typeof b.onCall.until === "string" ? b.onCall.until.slice(0, 16) : undefined } : { active: false };
    }
    await this.records.put<Staff>({ id: `${clubId}:${userId}`, kind: "clubstaff", key: clubId, ownerId: userId, data: next });
    return { ok: true, value: next };
  }

  async removeStaff(userId: string, clubId: string, target: string): Promise<CResult<true>> {
    const r = await this.need(clubId, userId, ["director"]);
    if (!r.ok) return r;
    if (target === r.value.club.directorId) return { ok: false, code: "invalid", message: "The club's main director can't be removed." };
    return (await this.records.delete("clubstaff", `${clubId}:${target}`)) ? { ok: true, value: true } : { ok: false, code: "not_found" };
  }

  // --- teams ------------------------------------------------------------------

  async clubTeams(clubId: string) {
    const links = await this.records.listByKey<{ teamId: string; ageGroup?: string }>("clubteam", clubId);
    const out = [];
    for (const l of links) {
      const t = await this.teams.getById(l.id);
      if (t) out.push({ id: t.id, name: t.name, code: t.code, coachOwnerId: t.coachOwnerId, ageGroup: l.data.ageGroup, players: (await this.teams.listMembers(t.id)).length });
      else await this.records.delete("clubteam", l.id);
    }
    return out;
  }

  /** Create a team in the club (the creator coaches it), or add one of your existing teams. */
  async addTeam(userId: string, clubId: string, b: { name?: string; teamId?: string; ageGroup?: string }): Promise<CResult<{ id: string; name: string; code: string }>> {
    const r = await this.need(clubId, userId, ["director", "coach"]);
    if (!r.ok) return r;
    let team;
    if (b.teamId) {
      team = await this.teams.getById(b.teamId);
      if (!team || (team.coachOwnerId !== userId && r.value.role !== "director")) return { ok: false, code: "not_found" };
      const other = await this.clubForTeam(team.id);
      if (other && other.id !== clubId) return { ok: false, code: "invalid", message: "That team belongs to another club." };
    } else {
      const n = clean(b.name, 80);
      if (!n) return { ok: false, code: "invalid", message: "Team name is required." };
      let c = newJoinCode();
      for (let i = 0; i < 5 && (await this.teams.getByCode(c)); i++) c = newJoinCode();
      team = await this.teams.create(userId, n, c);
    }
    await this.records.put({ id: team.id, kind: "clubteam", key: clubId, ownerId: team.coachOwnerId, data: { teamId: team.id, ageGroup: clean(b.ageGroup, 20) || undefined } });
    return { ok: true, value: { id: team.id, name: team.name, code: team.code } };
  }

  /** Every player in the club, with their team name and owner id. */
  private async roster(clubId: string) {
    const out: { team: { id: string; name: string }; ownerId: string; p: AthleteProfile }[] = [];
    for (const t of await this.clubTeams(clubId)) {
      for (const m of await this.teams.listMembers(t.id)) {
        const p = await this.profiles.getById(m.ownerId, m.profileId);
        if (p) out.push({ team: { id: t.id, name: t.name }, ownerId: m.ownerId, p });
      }
    }
    return out;
  }

  // --- medical roster, concussion log, dashboard ---------------------------------

  async medicalRoster(userId: string, clubId: string): Promise<CResult<{ club: string; generatedAt: string; role: StaffRole; rows: MedicalRow[] }>> {
    const r = await this.need(clubId, userId, ["director", "trainer"]);
    if (!r.ok) return r;
    const rows = (await this.roster(clubId)).map((x) => medicalRow(x.p, x.team.name, r.value.role));
    rows.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    return { ok: true, value: { club: r.value.club.name, generatedAt: new Date().toISOString(), role: r.value.role, rows } };
  }

  async concussionLog(userId: string, clubId: string) {
    const r = await this.need(clubId, userId, ["director", "trainer"]);
    if (!r.ok) return r;
    const out = [];
    for (const x of await this.roster(clubId)) {
      for (const c of x.p.health?.concussions || []) {
        out.push({
          profileId: x.p.id, name: x.p.identity.fullName, team: x.team.name, date: c.date, step: c.step,
          clearedAt: c.clearedAt, clearedBy: r.value.role === "trainer" ? c.clearedBy : c.clearedAt ? "provider" : undefined,
          history: r.value.role === "trainer" ? c.stepHistory : undefined, notes: r.value.role === "trainer" ? c.notes : undefined,
        });
      }
    }
    out.sort((a, b) => Number(!!a.clearedAt) - Number(!!b.clearedAt) || b.date.localeCompare(a.date));
    return { ok: true as const, value: out };
  }

  /** Athletic trainers can record return-to-play clearance for club players. */
  async trainerClear(userId: string, clubId: string, profileId: string, date: string): Promise<CResult<true>> {
    const r = await this.need(clubId, userId, ["trainer"]);
    if (!r.ok) return r;
    const me = await this.staff(clubId, userId);
    const x = (await this.roster(clubId)).find((y) => y.p.id === profileId);
    if (!x) return { ok: false, code: "not_found" };
    const c = (x.p.health?.concussions || []).find((k) => !k.clearedAt);
    if (!c) return { ok: false, code: "invalid", message: "No open concussion." };
    if (c.step < 4 || !isDay(date)) return { ok: false, code: "invalid", message: "The player must finish steps 1 to 4 without symptoms first." };
    const who = `${me?.name || "Athletic trainer"} (athletic trainer, ${r.value.club.name})`;
    const upd = { ...c, step: 6, clearedAt: date, clearedBy: who, stepHistory: [...c.stepHistory, { step: 5, date }, { step: 6, date }] };
    const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = x.p;
    await this.profiles.update(x.ownerId, x.p.id, { ...rest, health: { ...(rest.health as NonNullable<ProfileInput["health"]>), concussions: (rest.health?.concussions || []).map((k) => (k.id === c.id ? upd : k)) } });
    return { ok: true, value: true };
  }

  async dashboard(userId: string, clubId: string, today: string) {
    const r = await this.need(clubId, userId, ["director", "trainer"]);
    if (!r.ok) return r;
    const club = r.value.club;
    const teams = await this.clubTeams(clubId);
    const roster = await this.roster(clubId);
    const byTeam = new Map<string, { p: AthleteProfile; checkins: Awaited<ReturnType<CheckInRepository["listByProfile"]>> }[]>();
    for (const x of roster) {
      const cis = await this.checkins.listByProfile(x.ownerId, x.p.id, 40);
      byTeam.set(x.team.id, [...(byTeam.get(x.team.id) || []), { p: x.p, checkins: cis }]);
    }
    const health = teams.map((t) => teamHealth(t.id, t.name, byTeam.get(t.id) || [], today));
    const staff = (await this.records.listByKey<Staff>("clubstaff", clubId)).map((s) => s.data);
    const certs = staff.map((s) => ({ name: s.name || s.email || "Staff", role: s.role, ...certReport(s, today) })).filter((c) => c.missing.length || c.expired.length || c.expiring.length);
    return {
      ok: true as const,
      value: {
        club: publicClub(club, r.value.role === "director"), active: clubActive(club, today),
        totals: { teams: teams.length, players: roster.length, notCleared: health.reduce((a, h) => a + h.notCleared, 0), highRisk: health.reduce((a, h) => a + h.highRisk, 0), overloaded: health.reduce((a, h) => a + h.overloaded, 0) },
        teams: health.sort((a, b) => b.overloaded + b.highRisk - (a.overloaded + a.highRisk) || a.checkinRate7d - b.checkinRate7d),
        certs,
        fields: await this.fieldConditions(club, today),
        onCall: staff.filter((s) => s.onCall?.active).map((s) => ({ name: s.name, phone: s.phone, location: s.onCall?.location, until: s.onCall?.until })),
      },
    };
  }

  // --- fields: status and weather ---------------------------------------------

  async setField(userId: string, clubId: string, b: Partial<Field> & { remove?: boolean }): Promise<CResult<Field[]>> {
    const r = await this.need(clubId, userId, ["director", "coach"]);
    if (!r.ok) return r;
    const club = r.value.club;
    let fields = [...(club.fields || [])];
    if (b.remove && b.id) {
      if (r.value.role !== "director") return { ok: false, code: "forbidden" };
      fields = fields.filter((f) => f.id !== b.id);
    } else if (b.id) {
      const f = fields.find((x) => x.id === b.id);
      if (!f) return { ok: false, code: "not_found" };
      const status = b.status && ["open", "closed", "delayed"].includes(b.status) ? b.status : f.status;
      const changed = status !== f.status;
      Object.assign(f, { status, note: b.note !== undefined ? clean(b.note, 160) || undefined : f.note, updatedAt: new Date().toISOString() });
      if (changed && status !== "open") await this.announceField(club, f).catch(() => undefined);
    } else {
      if (r.value.role !== "director") return { ok: false, code: "forbidden" };
      const name = clean(b.name, 60), zip = clean(b.zip, 5);
      if (!name || !/^\d{5}$/.test(zip)) return { ok: false, code: "invalid", message: "Field needs a name and a 5-digit ZIP." };
      fields.push({ id: randomUUID(), name, zip, status: "open" });
    }
    await this.saveClub({ ...club, fields });
    return { ok: true, value: fields };
  }

  /** Post a closure to every team's announcements and email the coaches. */
  private async announceField(club: Club, f: Field) {
    const text = `${f.name} is ${f.status === "closed" ? "CLOSED" : "DELAYED"}${f.note ? `: ${f.note}` : "."}`;
    const emails = new Set<string>();
    for (const t of await this.clubTeams(club.id)) {
      await this.records.put({ id: randomUUID(), kind: "announce", key: t.id, ownerId: club.directorId, data: { text, by: club.name, createdAt: new Date().toISOString(), field: f.id } });
    }
    for (const s of (await this.records.listByKey<Staff>("clubstaff", club.id)).map((x) => x.data)) if (s.email) emails.add(s.email);
    if (emails.size) await this.mailer.send({ to: [...emails], subject: `${club.name}: ${f.name} ${f.status}`, text, html: `<p>${escHtml(text)}</p>` });
  }

  /** Today's and tomorrow's afternoon conditions at each club field. */
  async fieldConditions(club: Club, today: string) {
    const out = [];
    for (const f of club.fields || []) {
      const fc = this.weather ? await this.weather.forecast(f.zip).catch(() => null) : null;
      const c = fc ? summarize(f.zip, fc.hours, `${today}T15:00`, `${today}T20:00`, fc.place, fc.alerts) : null;
      const plan = c ? weatherPlan(c, { M: 50, kid: true, young: true, durationMin: 90 }) : null;
      out.push({ ...f, conditions: c ? { headline: c.headline, heat: c.heat, cold: c.cold, air: c.air, thunderPct: c.thunderPct } : null, severity: plan?.severity || "none", lightning: plan?.lightning || "none", warnings: plan?.warnings.slice(0, 3) || [] });
    }
    return out;
  }

  /** Scheduled: email coaches and staff when a field has heat, storms or bad air today. */
  async sendFieldAlerts(today: string, budgetMs = 20_000): Promise<number> {
    const t0 = Date.now();
    let sent = 0;
    for (const rec of await this.records.listByKind<Club>("club", 2000)) {
      if (Date.now() - t0 > budgetMs) break;
      const club = rec.data;
      if (!clubActive(club, today) || !(club.fields || []).length) continue;
      const bad = (await this.fieldConditions(club, today)).filter((f) => f.severity === "high" || f.severity === "extreme" || f.lightning === "likely");
      if (!bad.length) continue;
      const already = await this.records.get("report", `fieldalert:${club.id}:${today}`);
      if (already) continue;
      const staff = (await this.records.listByKey<Staff>("clubstaff", club.id)).map((s) => s.data);
      const coaches = new Set(staff.filter((s) => s.email).map((s) => s.email!));
      const lines = bad.map((f) => `${f.name} (${f.zip}): ${f.conditions?.headline || ""}. ${f.warnings[0] || ""}`);
      const text = `Weather alert for ${club.name} fields today:\n\n${lines.join("\n\n")}\n\nCheck the club dashboard for details.`;
      if (coaches.size) await this.mailer.send({ to: [...coaches], subject: `${club.name}: weather alert for today`, text, html: text.split("\n\n").map((t) => `<p>${escHtml(t)}</p>`).join("") });
      for (const t of await this.clubTeams(club.id)) await this.records.put({ id: randomUUID(), kind: "announce", key: t.id, ownerId: club.directorId, data: { text: lines.join(" "), by: `${club.name} weather alert`, createdAt: new Date().toISOString() } });
      await this.records.put({ id: `fieldalert:${club.id}:${today}`, kind: "report", key: today, ownerId: club.directorId, data: { fields: bad.length } });
      sent++;
    }
    return sent;
  }

  // --- what a player's family sees -----------------------------------------------

  /** Club branding, sponsor, on-call trainer and field status for a player's teams. */
  async forProfile(ownerId: string, profileId: string) {
    const memberships = await this.teams.listMembershipsForProfile(ownerId, profileId);
    const clubs = new Map<string, Club>();
    for (const m of memberships) { const c = await this.clubForTeam(m.teamId); if (c) clubs.set(c.id, c); }
    const out = [];
    for (const c of clubs.values()) {
      const active = clubActive(c);
      const staff = (await this.records.listByKey<Staff>("clubstaff", c.id)).map((s) => s.data);
      out.push({
        id: c.id, name: c.name,
        brand: active ? { logoUrl: c.logoUrl, primary: c.primary, accent: c.accent } : null,
        sponsor: active ? c.sponsor || null : null,
        onCall: staff.filter((s) => s.onCall?.active && s.phone).map((s) => ({ name: s.name || "Athletic trainer", phone: s.phone, location: s.onCall?.location, until: s.onCall?.until })),
        fields: (c.fields || []).filter((f) => f.status !== "open").map((f) => ({ name: f.name, status: f.status, note: f.note, updatedAt: f.updatedAt })),
      });
    }
    return out;
  }
}

/** Hide billing details from non-directors. */
function publicClub(c: Club, director: boolean) {
  const { stripeCustomerId: _s, stripeSubscriptionId: _t, ...rest } = c;
  return director ? rest : { id: c.id, name: c.name, logoUrl: c.logoUrl, primary: c.primary, accent: c.accent, sponsor: c.sponsor, fields: c.fields };
}

