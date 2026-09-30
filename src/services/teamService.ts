/**
 * Team service: coach rosters and player join/leave.
 *
 * Access rules:
 *  - Any signed-in account can create a team and becomes its coach.
 *  - Only the coach who owns a team sees its roster or removes players.
 *  - Only the owner of a profile can join it to a team (with the join code)
 *    or take it off a team.
 *  - The roster exposes a limited view (see domain/team.ts), never contact
 *    details, medical notes or full check-in history.
 */

import type { AthleteProfileRepository, CheckInRepository, TeamRepository } from "../data/repository.js";
import { newJoinCode, normalizeCode, type RosterEntry, type Team } from "../domain/team.js";
import { computeReadiness } from "../domain/readiness.js";
import { nextMatchFrom } from "../domain/daily.js";
import { eventDate, eventTime } from "../domain/dates.js";
import { coachFlags } from "../domain/health.js";
import { teamMenu, type TeamMenu } from "../domain/teamMeal.js";
import type { AthleteProfile } from "../domain/profile.js";
import type { Mailer } from "./notifier.js";
import { escHtml } from "./notifier.js";
import type { FamilyService } from "./familyService.js";

export type TeamResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "not_found" | "forbidden" | "invalid"; message?: string };

export interface TeamWithCount extends Team {
  memberCount: number;
}

export class TeamService {
  constructor(
    private readonly teams: TeamRepository,
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family?: FamilyService,
    private readonly mailer?: Mailer,
  ) {}

  async create(coachOwnerId: string, name: string): Promise<TeamResult<Team>> {
    const clean = String(name ?? "").trim().slice(0, 80);
    if (!clean) return { ok: false, code: "invalid", message: "Team name is required." };
    for (let i = 0; i < 6; i++) {
      const code = newJoinCode();
      if (!(await this.teams.getByCode(code))) {
        return { ok: true, value: await this.teams.create(coachOwnerId, clean, code) };
      }
    }
    return { ok: false, code: "invalid", message: "Could not generate a join code. Try again." };
  }

  async listMine(coachOwnerId: string): Promise<TeamWithCount[]> {
    const list = await this.teams.listByCoach(coachOwnerId);
    return Promise.all(
      list.map(async (t) => ({ ...t, memberCount: (await this.teams.listMembers(t.id)).length })),
    );
  }

  async remove(coachOwnerId: string, teamId: string): Promise<TeamResult<true>> {
    return (await this.teams.delete(coachOwnerId, teamId))
      ? { ok: true, value: true }
      : { ok: false, code: "not_found" };
  }

  async roster(coachOwnerId: string, teamId: string, today: string): Promise<TeamResult<{ team: Team; players: RosterEntry[] }>> {
    const team = await this.teams.getById(teamId);
    if (!team) return { ok: false, code: "not_found" };
    if (team.coachOwnerId !== coachOwnerId) return { ok: false, code: "forbidden" };

    const members = await this.teams.listMembers(teamId);
    const players: RosterEntry[] = [];
    for (const m of members) {
      const p = await this.profiles.getById(m.ownerId, m.profileId);
      if (!p) continue;
      const recent = await this.checkins.listByProfile(m.ownerId, m.profileId, 1);
      const last = recent[0] || null;
      const nm = nextMatchFrom(p, today);
      players.push({
        profileId: p.id,
        name: p.identity.fullName,
        avatarUrl: p.identity.avatarUrl,
        playerCode: p.identity.playerCode,
        positions: p.sport.positions || [],
        jerseyNumber: p.identity.jerseyNumber,
        readiness: computeReadiness(last),
        lastCheckinDate: last?.date ?? null,
        soreness: last?.sorenessLevel ?? null,
        sleepHours: last?.sleepHoursLastNight ?? null,
        nextMatch: nm ? { date: eventDate(nm), time: eventTime(nm) } : null,
        allergies: [
          ...(p.nutrition.allergies || []).map((a) => (a.allergen === "other" ? a.note || "other" : a.allergen) + (a.anaphylaxis || a.epinephrine ? " (severe, EpiPen)" : "")),
          ...((p.nutrition.medicalDiets || []).includes("celiac") ? ["gluten (strict)"] : []),
        ],
        diets: p.nutrition.dietaryRestrictions || [],
        injuryFlag: (p.health?.currentInjuries || []).length > 0,
        flags: coachFlags(p, today, last && last.date === today ? last : null),
        checkedInToday: last?.date === today,
        joinedAt: m.joinedAt,
      });
    }
    return { ok: true, value: { team, players } };
  }

  async removePlayer(coachOwnerId: string, teamId: string, profileId: string): Promise<TeamResult<true>> {
    const team = await this.teams.getById(teamId);
    if (!team) return { ok: false, code: "not_found" };
    if (team.coachOwnerId !== coachOwnerId) return { ok: false, code: "forbidden" };
    return (await this.teams.removeMember(teamId, profileId))
      ? { ok: true, value: true }
      : { ok: false, code: "not_found" };
  }

  /** A profile's owner joins it to a team using the coach's join code. */
  async join(ownerId: string, profileId: string, code: string): Promise<TeamResult<Team>> {
    const profile = await this.profiles.getById(ownerId, profileId);
    if (!profile) return { ok: false, code: "not_found", message: "Profile not found." };
    const team = await this.teams.getByCode(normalizeCode(code));
    if (!team) return { ok: false, code: "invalid", message: "That team code was not found. Check it with your coach." };
    await this.teams.addMember({ teamId: team.id, profileId, ownerId, joinedAt: new Date().toISOString() });
    await this.notifyParents(profile, team).catch(() => undefined);
    return { ok: true, value: team };
  }

  async leave(ownerId: string, profileId: string, teamId: string): Promise<TeamResult<true>> {
    const memberships = await this.teams.listMembershipsForProfile(ownerId, profileId);
    if (!memberships.some((m) => m.teamId === teamId)) return { ok: false, code: "not_found" };
    await this.teams.removeMember(teamId, profileId);
    return { ok: true, value: true };
  }

  /** Teams a profile belongs to (name + coach-facing code hidden). */
  async teamsForProfile(ownerId: string, profileId: string): Promise<TeamResult<{ id: string; name: string; joinedAt: string }[]>> {
    const profile = await this.profiles.getById(ownerId, profileId);
    if (!profile) return { ok: false, code: "not_found" };
    const memberships = await this.teams.listMembershipsForProfile(ownerId, profileId);
    const out: { id: string; name: string; joinedAt: string }[] = [];
    for (const m of memberships) {
      const t = await this.teams.getById(m.teamId);
      if (t) out.push({ id: t.id, name: t.name, joinedAt: m.joinedAt });
    }
    return { ok: true, value: out };
  }

  /** Coach safeguard: parents always hear when their player joins a team. */
  private async notifyParents(profile: AthleteProfile, team: Team): Promise<void> {
    if (!this.family || !this.mailer) return;
    const to = await this.family.parentEmails(profile);
    if (!to.length) return;
    const name = profile.identity.fullName;
    const text = `${name} joined the team "${team.name}" in Athlete Performance.\n\nThe coach can see: name, position, jersey number, readiness color, allergies (for team meals) and safety flags (not cleared to play, EpiPen, inhaler). The coach can't see medical details, weight, messages or the full check-in history.\n\nIf you don't recognize this team, open the app, go to Settings, and remove the team.`;
    await this.mailer.send({ to, subject: `${name} joined ${team.name}`, text, html: text.split("\n\n").map((t) => `<p>${escHtml(t)}</p>`).join("") });
  }

  /** Readiness board + counts for the coach. */
  async dashboard(coachOwnerId: string, teamId: string, today: string) {
    const r = await this.roster(coachOwnerId, teamId, today);
    if (!r.ok) return r;
    const players = r.value.players;
    const count = (st: string) => players.filter((p) => p.checkedInToday && p.readiness?.status === st).length;
    return {
      ok: true as const,
      value: {
        team: r.value.team,
        players,
        summary: {
          total: players.length,
          checkedIn: players.filter((p) => p.checkedInToday).length,
          green: count("ready"), yellow: count("moderate"), red: count("low"),
          notCleared: players.filter((p) => p.flags.some((f) => f.startsWith("Not cleared"))).map((p) => p.name),
          out: players.filter((p) => p.flags.includes("Out sick today")).map((p) => p.name),
        },
      },
    };
  }

  /** One food order that is safe for every player on the roster. */
  async meal(coachOwnerId: string, teamId: string, gameDay: boolean): Promise<TeamResult<TeamMenu>> {
    const team = await this.teams.getById(teamId);
    if (!team) return { ok: false, code: "not_found" };
    if (team.coachOwnerId !== coachOwnerId) return { ok: false, code: "forbidden" };
    const members = await this.teams.listMembers(teamId);
    const roster: AthleteProfile[] = [];
    for (const m of members) { const p = await this.profiles.getById(m.ownerId, m.profileId); if (p) roster.push(p); }
    return { ok: true, value: teamMenu(roster, { gameDay }) };
  }
}
