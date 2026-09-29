/**
 * Insight service: Today, recovery, trends, grocery list and reminders.
 *
 * Owner-scoped like every other service: it loads the caller's own profile and
 * check-ins, then hands them to the pure engines in src/domain.
 */

import type { AthleteProfileRepository, CheckInRepository } from "../data/repository.js";
import type { AthleteProfile } from "../domain/profile.js";
import { buildToday, type TodaySummary } from "../domain/daily.js";
import { buildRecoveryPlan, type RecoveryPlan } from "../domain/recovery.js";
import { buildTrends, type TrendSummary } from "../domain/trends.js";
import { buildGroceryList, type GroceryList } from "../domain/grocery.js";
import { buildReminders, type Reminder, type ReminderPrefs } from "../domain/reminders.js";
import { buildProgram, type Program } from "../domain/program.js";

export type Found<T> = { ok: true; value: T } | { ok: false; code: "not_found" };

export interface TodayResponse extends TodaySummary {
  reminders: Reminder[];
}

export class InsightService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
  ) {}

  private async load(ownerId: string, id: string): Promise<AthleteProfile | null> {
    return this.profiles.getById(ownerId, id);
  }

  async today(ownerId: string, id: string, date: string, now?: string): Promise<Found<TodayResponse>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    const ci = await this.checkins.getByDate(ownerId, id, date);
    const summary = buildToday(p, date, ci);
    const reminders = buildReminders(p, { from: date, days: 1, now });
    return { ok: true, value: { ...summary, reminders } };
  }

  async recovery(ownerId: string, id: string, today: string, anchorDate?: string): Promise<Found<RecoveryPlan>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    const checkins = await this.checkins.listByProfile(ownerId, id, 21);
    return { ok: true, value: buildRecoveryPlan(p, { today, anchorDate, checkins }) };
  }

  async trends(ownerId: string, id: string, today: string, days = 28): Promise<Found<TrendSummary>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    const checkins = await this.checkins.listByProfile(ownerId, id, 60);
    return { ok: true, value: buildTrends(id, checkins, today, days) };
  }

  async grocery(ownerId: string, id: string, from: string, days = 7): Promise<Found<GroceryList>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    return { ok: true, value: buildGroceryList(p, from, days) };
  }

  async reminders(
    ownerId: string,
    id: string,
    opts: { from: string; days?: number; now?: string; prefs?: ReminderPrefs },
  ): Promise<Found<Reminder[]>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    return { ok: true, value: buildReminders(p, opts) };
  }

  async program(ownerId: string, id: string): Promise<Found<Program>> {
    const p = await this.load(ownerId, id);
    if (!p) return { ok: false, code: "not_found" };
    return { ok: true, value: buildProgram(p) };
  }
}
