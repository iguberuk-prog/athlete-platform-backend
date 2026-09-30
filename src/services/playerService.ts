/**
 * Player extras: journal and stats, progress (streaks and badges), early
 * warning score, "what worked" insights, season review, tournament planner,
 * mental skills, emergency card, SafeSport, budget.
 *
 * Game logs and expenses live in app_records (kinds "gamelog", "expense",
 * "budgetplan"), keyed by profile id, owned by the profile's owner.
 */

import { randomUUID } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository } from "../data/repository.js";
import type { AthleteProfile } from "../domain/profile.js";
import { validateGameLog, seasonStats, whatWorked, type GameLog, type GameLogInput } from "../domain/journal.js";
import { buildProgress } from "../domain/progress.js";
import { riskScore } from "../domain/risk.js";
import { mentalSkills } from "../domain/mental.js";
import { tournamentPlans } from "../domain/tournament.js";
import { emergencyCard, SAFESPORT } from "../domain/safety.js";
import { budgetSummary, seasonRange, validateExpense, type Expense, type ExpenseInput } from "../domain/budget.js";
import { positionFuel } from "../domain/daily.js";
import { buildHealthStatus } from "../domain/health.js";
import { featuresFor } from "../domain/features.js";
import type { FamilyService } from "./familyService.js";

export type PResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid"; message?: string };

export class PlayerService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
  ) {}

  private async load(userId: string, id: string): Promise<{ owner: string; p: AthleteProfile } | null> {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }

  async logs(profileId: string): Promise<GameLog[]> {
    return (await this.records.listByKey<GameLog>("gamelog", profileId)).map((r) => r.data).sort((a, b) => b.date.localeCompare(a.date));
  }

  // --- journal ---------------------------------------------------------------

  async addLog(userId: string, id: string, input: GameLogInput): Promise<PResult<GameLog>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const errs = validateGameLog(input);
    if (errs.length) return { ok: false, code: "invalid", message: errs.join("; ") };
    const log: GameLog = { ...pickLog(input), id: randomUUID(), createdAt: new Date().toISOString() };
    await this.records.put({ id: log.id, kind: "gamelog", key: id, ownerId: r.owner, data: log });
    return { ok: true, value: log };
  }

  async deleteLog(userId: string, id: string, logId: string): Promise<PResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const rec = await this.records.get("gamelog", logId);
    if (!rec || rec.key !== id) return { ok: false, code: "not_found" };
    await this.records.delete("gamelog", logId);
    return { ok: true, value: true };
  }

  async journal(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    const [logs, cis] = await Promise.all([this.logs(id), this.checkins.listByProfile(r.owner, id, 365)]);
    const season = seasonRange(today);
    return { logs, season, stats: seasonStats(logs, season.from, season.to), allTime: seasonStats(logs), worked: whatWorked(r.p, logs, cis) };
  }

  // --- progress, risk, extras ---------------------------------------------------

  async progress(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    const [logs, cis, hw] = await Promise.all([this.logs(id), this.checkins.listByProfile(r.owner, id, 400), this.records.listByKey<{ date: string }>("homework_done", id)]);
    return buildProgress(r.p, { checkins: cis, reflectionDates: logs.filter((l) => l.wentWell || l.workOn || l.rating).map((l) => l.date), homeworkDates: hw.map((h) => h.data.date) }, today, { freezes: featuresFor(r.p).on.streakFreeze });
  }

  async risk(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    return riskScore(r.p, await this.checkins.listByProfile(r.owner, id, 60), today);
  }

  async extras(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    return {
      mental: mentalSkills(r.p),
      position: positionFuel(r.p),
      tournaments: tournamentPlans(r.p, today),
      emergency: emergencyCard(r.p),
      safesport: SAFESPORT,
    };
  }

  /** Everything for the printable season review. */
  async seasonReview(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    const season = seasonRange(today);
    const [logs, cis, prog] = await Promise.all([this.logs(id), this.checkins.listByProfile(r.owner, id, 400), this.progress(userId, id, today)]);
    const inSeason = cis.filter((c) => c.date >= season.from && c.date <= season.to);
    const sleeps = inSeason.map((c) => c.sleepHoursLastNight).filter((x): x is number => typeof x === "number");
    const status = buildHealthStatus(r.p, cis, today, { viewer: "parent" });
    const seasonLogs = logs.filter((l) => l.date >= season.from && l.date <= season.to);
    return {
      name: r.p.identity.fullName,
      position: (r.p.sport.positions || [])[0] || "",
      team: r.p.identity.clubTeam || r.p.identity.school || "",
      season,
      stats: seasonStats(seasonLogs),
      checkins: inSeason.length,
      avgSleep: sleeps.length ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) / 10 : null,
      warmups: inSeason.filter((c) => c.warmupDone).length,
      badges: prog?.badges.filter((b) => b.earned).map((b) => b.name) || [],
      bestStreak: prog?.streaks.find((s) => s.id === "checkin")?.best || 0,
      highlights: seasonLogs.filter((l) => l.wentWell).slice(0, 8).map((l) => ({ date: l.date, text: l.wentWell! })),
      goals: seasonLogs.filter((l) => l.workOn).slice(0, 5).map((l) => l.workOn!),
      worked: whatWorked(r.p, seasonLogs, cis).insights,
      concussions: (r.p.health?.concussions || []).filter((c) => c.date >= season.from).length,
      hideWeight: status.hideWeight,
    };
  }

  // --- budget ------------------------------------------------------------------

  async budget(userId: string, id: string, today: string) {
    const r = await this.load(userId, id);
    if (!r) return null;
    const ex = (await this.records.listByKey<Expense>("expense", id)).map((x) => x.data);
    const plan = await this.records.get<{ amount: number }>("budgetplan", id);
    const { from, to } = seasonRange(today);
    return budgetSummary(ex, from, to, plan?.data.amount);
  }

  async addExpense(userId: string, id: string, input: ExpenseInput): Promise<PResult<Expense>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const errs = validateExpense(input);
    if (errs.length) return { ok: false, code: "invalid", message: errs.join("; ") };
    const x: Expense = { id: randomUUID(), date: input.date, category: input.category, amount: Math.round(input.amount * 100) / 100, note: input.note?.trim() || undefined };
    await this.records.put({ id: x.id, kind: "expense", key: id, ownerId: r.owner, data: x });
    return { ok: true, value: x };
  }

  async deleteExpense(userId: string, id: string, exId: string): Promise<PResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const rec = await this.records.get("expense", exId);
    if (!rec || rec.key !== id) return { ok: false, code: "not_found" };
    await this.records.delete("expense", exId);
    return { ok: true, value: true };
  }

  async setBudgetPlan(userId: string, id: string, amount: number | null): Promise<PResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (amount === null || amount === 0) { await this.records.delete("budgetplan", id); return { ok: true, value: true }; }
    if (!(typeof amount === "number" && amount > 0 && amount <= 1_000_000)) return { ok: false, code: "invalid", message: "Budget must be a positive amount." };
    await this.records.put({ id, kind: "budgetplan", key: id, ownerId: r.owner, data: { amount } });
    return { ok: true, value: true };
  }

  features(p: AthleteProfile) { return featuresFor(p); }
}

/** Only known fields, trimmed. */
function pickLog(x: GameLogInput): GameLogInput {
  const t = (s?: string) => (s && s.trim() ? s.trim() : undefined);
  return {
    date: x.date, type: x.type, opponent: t(x.opponent), minutes: x.minutes, started: x.started, position: t(x.position),
    goals: x.goals, assists: x.assists, shots: x.shots, saves: x.saves, cleanSheet: x.cleanSheet, rating: x.rating,
    wentWell: t(x.wentWell), workOn: t(x.workOn), preGameMeal: x.preGameMeal, result: x.result, notes: t(x.notes),
  };
}
