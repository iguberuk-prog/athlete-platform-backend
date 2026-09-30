/**
 * Profile service — the business logic between the HTTP layer and the database.
 *
 * Responsibilities:
 *  - run safety validation before anything is written
 *  - enforce owner-only access via the repository contract
 *  - translate outcomes into typed results the HTTP layer can map to status codes
 *
 * It deliberately knows nothing about HTTP or about which database is in use.
 */

import type { AthleteProfile, ProfileInput, ScheduledEvent } from "../domain/profile.js";
import {
  validateProfileInput,
  validateEventInputs,
  type ValidationError,
} from "../domain/validation.js";
import type { AthleteProfileRepository } from "../data/repository.js";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "validation"; errors: ValidationError[] }
  | { ok: false; code: "not_found" };

export class ProfileService {
  constructor(private readonly repo: AthleteProfileRepository) {}

  async create(
    ownerId: string,
    input: ProfileInput,
  ): Promise<ServiceResult<AthleteProfile>> {
    const result = validateProfileInput(input);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    const value = await this.repo.create(ownerId, input);
    return { ok: true, value };
  }

  async get(ownerId: string, id: string): Promise<ServiceResult<AthleteProfile>> {
    const value = await this.repo.getById(ownerId, id);
    return value ? { ok: true, value } : { ok: false, code: "not_found" };
  }

  async list(ownerId: string): Promise<AthleteProfile[]> {
    return this.repo.listByOwner(ownerId);
  }

  /** All profiles across owners. Admin-only — the caller must authenticate. */
  async listAll(): Promise<AthleteProfile[]> {
    return this.repo.listAll();
  }

  async update(
    ownerId: string,
    id: string,
    input: ProfileInput,
  ): Promise<ServiceResult<AthleteProfile>> {
    const result = validateProfileInput(input);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    const prev = await this.repo.getById(ownerId, id);
    if (!prev) return { ok: false, code: "not_found" };
    const value = await this.repo.update(ownerId, id, keepManaged(prev, input));
    return value ? { ok: true, value } : { ok: false, code: "not_found" };
  }

  async delete(ownerId: string, id: string): Promise<ServiceResult<true>> {
    const removed = await this.repo.delete(ownerId, id);
    return removed ? { ok: true, value: true } : { ok: false, code: "not_found" };
  }

  /** Append one or more scheduled events (fixtures) to a profile's schedule. */
  async addEvents(
    ownerId: string,
    id: string,
    events: ScheduledEvent[],
  ): Promise<ServiceResult<AthleteProfile>> {
    const result = validateEventInputs(events);
    if (!result.valid) {
      return { ok: false, code: "validation", errors: result.errors };
    }
    const profile = await this.repo.getById(ownerId, id);
    if (!profile) return { ok: false, code: "not_found" };

    const { id: _id, ownerId: _o, createdAt: _c, updatedAt: _u, ...input } = profile;
    const prev = profile.schedule?.events || [];
    const updated = await this.repo.update(ownerId, id, {
      ...input,
      schedule: { ...(profile.schedule || { events: [] }), events: [...prev, ...events] },
    });
    return updated ? { ok: true, value: updated } : { ok: false, code: "not_found" };
  }

  /** Return a profile's scheduled events, soonest first. */
  async listEvents(ownerId: string, id: string): Promise<ServiceResult<ScheduledEvent[]>> {
    const profile = await this.repo.getById(ownerId, id);
    if (!profile) return { ok: false, code: "not_found" };
    const events = [...(profile.schedule?.events || [])].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
    return { ok: true, value: events };
  }

  /**
   * Remove events from a profile's schedule. Matches on startTime (and type
   * when given). With `series`, removes every event of that type at the same
   * weekday and time on or after startTime (a repeating practice).
   */
  async removeEvents(
    ownerId: string,
    id: string,
    match: { startTime: string; type?: string; series?: boolean },
  ): Promise<ServiceResult<AthleteProfile>> {
    const profile = await this.repo.getById(ownerId, id);
    if (!profile) return { ok: false, code: "not_found" };
    const events = profile.schedule?.events || [];
    const time = match.startTime.slice(11, 16);
    const weekday = new Date(match.startTime.slice(0, 10) + "T12:00:00Z").getUTCDay();
    const keep = events.filter((e) => {
      if (match.type && e.type !== match.type) return true;
      if (!match.series) return e.startTime !== match.startTime;
      const sameSlot =
        e.startTime.slice(11, 16) === time &&
        new Date(e.startTime.slice(0, 10) + "T12:00:00Z").getUTCDay() === weekday &&
        e.startTime >= match.startTime;
      return !sameSlot;
    });
    if (keep.length === events.length) return { ok: false, code: "not_found" };
    const { id: _id, ownerId: _o, createdAt: _c, updatedAt: _u, ...input } = profile;
    const updated = await this.repo.update(ownerId, id, {
      ...input,
      schedule: { ...(profile.schedule || { events: [] }), events: keep },
    });
    return updated ? { ok: true, value: updated } : { ok: false, code: "not_found" };
  }
}

/**
 * Fields the server manages through their own endpoints (concussion steps,
 * sweat tests, height log, calendar feeds). A full-profile save from the app
 * can't overwrite them, so a return-to-play step can't be skipped by editing.
 */
export function keepManaged(prev: AthleteProfile, input: ProfileInput): ProfileInput {
  const out: ProfileInput = { ...input };
  if (prev.health?.concussions) out.health = { injuryHistory: [], currentInjuries: [], medicalConditions: [], medications: [], ...(input.health || {}), concussions: prev.health.concussions };
  if (prev.advanced?.sweatTests) out.advanced = { ...(input.advanced || {}), sweatTests: prev.advanced.sweatTests, sweatRateLitresPerHour: prev.advanced.sweatRateLitresPerHour };
  if (prev.anthropometrics.heightHistory) out.anthropometrics = { ...input.anthropometrics, heightHistory: prev.anthropometrics.heightHistory };
  if (prev.schedule?.feeds) {
    const imported = (prev.schedule.events || []).filter((e) => e.source && e.source !== "manual");
    const manual = (input.schedule?.events || []).filter((e) => !e.source || e.source === "manual");
    out.schedule = { ...(input.schedule || { events: [] }), events: [...manual, ...imported], feeds: prev.schedule.feeds };
  }
  return out;
}
