/**
 * Health, meals and day-plan service.
 *
 * Reads go through FamilyService.ownerFor, so a linked parent or player sees
 * the same screens as the owner. Every feature is checked against the age
 * rules in domain/features.ts on the server too, not just hidden in the UI.
 */

import { randomUUID } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository } from "../data/repository.js";
import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import { buildHealthStatus, computeSweatTest, medianSweatRate, sweatAdvice, activeConcussion, type SweatTestInput } from "../domain/health.js";
import { schoolDayPlan, travelPlans } from "../domain/dayplans.js";
import { buildMealPlan, eatingOutGuide, safeRecipes } from "../domain/meals.js";
import { featuresFor, type FeatureId } from "../domain/features.js";
import { effectiveAge } from "../domain/profile.js";
import type { WeatherProvider } from "../weather/nws.js";
import { loadWeather } from "./weatherService.js";
import type { FamilyService } from "./familyService.js";

export type HealthResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "not_found" | "invalid" | "age"; message?: string };

const strip = (p: AthleteProfile): ProfileInput => {
  const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
};

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export class HealthService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly weather: WeatherProvider | null = null,
  ) {}

  private async load(userId: string, id: string): Promise<{ owner: string; p: AthleteProfile } | null> {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }

  private gate(p: AthleteProfile, f: FeatureId): HealthResult<never> | null {
    const fs = featuresFor(p);
    return fs.on[f] ? null : { ok: false, code: "age", message: fs.off[f] || "Not available for this age." };
  }

  private async save(owner: string, p: AthleteProfile, change: (x: ProfileInput) => ProfileInput): Promise<AthleteProfile | null> {
    return this.profiles.update(owner, p.id, change(strip(p)));
  }

  async status(userId: string, id: string, today: string, viewer?: "player" | "parent") {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" } as const;
    const cis = await this.checkins.listByProfile(r.owner, id, 120);
    const [school, wx] = [schoolDayPlan(r.p, today), await loadWeather(this.weather, r.p, today, 7)];
    const f = featuresFor(r.p);
    return {
      ok: true, value: {
        ...buildHealthStatus(r.p, cis, today, { viewer }),
        school: f.on.schoolDay ? school : null,
        travel: travelPlans(r.p, today, wx),
      },
    } as const;
  }

  async addSweatTest(userId: string, id: string, input: SweatTestInput): Promise<HealthResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "sweatTest"); if (g) return g;
    if (!isDay(input?.date)) return { ok: false, code: "invalid", message: "Pick the date of the session." };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const t = computeSweatTest({ date: input.date, preKg: n(input.preKg), postKg: n(input.postKg), fluidL: n(input.fluidL), urineL: input.urineL ? n(input.urineL) : 0, minutes: n(input.minutes), tempF: input.tempF ? n(input.tempF) : undefined }, randomUUID());
    if ("error" in t) return { ok: false, code: "invalid", message: t.error };
    const tests = [...(r.p.advanced?.sweatTests || []), t].slice(-12);
    await this.save(r.owner, r.p, (x) => ({ ...x, advanced: { ...(x.advanced || {}), sweatTests: tests, sweatRateLitresPerHour: medianSweatRate(tests) } }));
    return { ok: true, value: { test: t, advice: sweatAdvice(t, effectiveAge(r.p.identity)), rateLph: medianSweatRate(tests) } };
  }

  async addHeight(userId: string, id: string, date: string, heightCm: number): Promise<HealthResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "growth"); if (g) return g;
    if (!isDay(date) || !(heightCm >= 90 && heightCm <= 230)) return { ok: false, code: "invalid", message: "Enter a date and a height in centimeters (90-230)." };
    const hist = [...(r.p.anthropometrics.heightHistory || []).filter((h) => h.date !== date), { date, heightCm }].sort((a, b) => a.date.localeCompare(b.date)).slice(-40);
    const latest = hist[hist.length - 1];
    const saved = await this.save(r.owner, r.p, (x) => ({ ...x, anthropometrics: { ...x.anthropometrics, heightHistory: hist, heightCm: latest.heightCm } }));
    return { ok: true, value: saved };
  }

  async reportConcussion(userId: string, id: string, date: string, notes?: string): Promise<HealthResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (!isDay(date)) return { ok: false, code: "invalid", message: "Pick the date it happened." };
    if (activeConcussion(r.p)) return { ok: false, code: "invalid", message: "A concussion is already open. Finish its return-to-play steps first." };
    const c = { id: randomUUID(), date, notes: notes ? String(notes).slice(0, 500) : undefined, step: 0, stepHistory: [{ step: 0, date }] };
    const saved = await this.save(r.owner, r.p, (x) => ({ ...x, health: { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [], ...(x.health || {}), concussions: [...(x.health?.concussions || []), c] } }));
    return { ok: true, value: saved };
  }

  /**
   * Move along the ladder. Up to step 4 the family can advance, once per 24 h
   * with no symptoms. Steps 5-6 need a provider's clearance (clear()).
   * Symptoms send the player back one step.
   */
  async concussionStep(userId: string, id: string, date: string, symptoms: boolean): Promise<HealthResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const c = activeConcussion(r.p);
    if (!c) return { ok: false, code: "invalid", message: "No open concussion." };
    if (!isDay(date)) return { ok: false, code: "invalid", message: "Bad date." };
    const last = c.stepHistory[c.stepHistory.length - 1];
    let step = c.step;
    if (symptoms) step = Math.max(0, c.step - 1);
    else {
      if (c.step >= 4) return { ok: false, code: "invalid", message: "The next step needs written clearance from a health care provider." };
      if (last && date <= last.date) return { ok: false, code: "invalid", message: "Each step takes at least 24 hours. Try again tomorrow." };
      step = c.step + 1;
    }
    const upd = { ...c, step, stepHistory: [...c.stepHistory, { step, date, symptoms: symptoms || undefined }] };
    const saved = await this.save(r.owner, r.p, (x) => ({ ...x, health: { ...(x.health as NonNullable<ProfileInput["health"]>), concussions: (x.health?.concussions || []).map((k) => (k.id === c.id ? upd : k)) } }));
    return { ok: true, value: saved };
  }

  /** Record a provider's written clearance. Moves to step 5 (full practice); games follow. */
  async clearConcussion(userId: string, id: string, date: string, clearedBy: string): Promise<HealthResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const c = activeConcussion(r.p);
    if (!c) return { ok: false, code: "invalid", message: "No open concussion." };
    const who = String(clearedBy || "").trim().slice(0, 120);
    if (!isDay(date) || who.length < 3) return { ok: false, code: "invalid", message: "Enter the provider's name and the date on the clearance note." };
    if (c.step < 4) return { ok: false, code: "invalid", message: "Finish steps 1 to 4 without symptoms first." };
    const upd = { ...c, step: 6, clearedBy: who, clearedAt: date, stepHistory: [...c.stepHistory, { step: 5, date }, { step: 6, date }] };
    const saved = await this.save(r.owner, r.p, (x) => ({ ...x, health: { ...(x.health as NonNullable<ProfileInput["health"]>), concussions: (x.health?.concussions || []).map((k) => (k.id === c.id ? upd : k)) } }));
    return { ok: true, value: saved };
  }

  async meals(userId: string, id: string, from: string) {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" } as const;
    return { ok: true, value: { plan: buildMealPlan(r.p, from, 7), eatingOut: eatingOutGuide(r.p) } } as const;
  }

  async recipes(userId: string, id: string) {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" } as const;
    return { ok: true, value: safeRecipes(r.p) } as const;
  }
}
