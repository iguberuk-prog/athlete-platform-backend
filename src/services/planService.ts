/**
 * Plan service — fetches what the match-day engine needs and runs it.
 *
 * Owner-scoped: only builds a plan for a profile the caller owns. Looks for a
 * real match on the requested date; if none, uses an assumed (or supplied)
 * kickoff so a plan can still be produced for a demo or ad-hoc match.
 */

import type {
  AthleteProfileRepository,
  CheckInRepository,
} from "../data/repository.js";
import { buildMatchDayPlan, type MatchDayPlan } from "../domain/plan.js";

export type PlanResult =
  | { ok: true; value: MatchDayPlan }
  | { ok: false; code: "not_found" };

export interface PlanRequest {
  date: string; // YYYY-MM-DD
  kickoff?: string; // HH:MM (optional override)
  conditions?: string;
}

export class PlanService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
  ) {}

  async matchDay(
    ownerId: string,
    profileId: string,
    req: PlanRequest,
  ): Promise<PlanResult> {
    const profile = await this.profiles.getById(ownerId, profileId);
    if (!profile) return { ok: false, code: "not_found" };

    const checkin = await this.checkins.getByDate(ownerId, profileId, req.date);

    // Find a real match on the requested date.
    const match = (profile.schedule?.events || []).find(
      (e) => e.type === "match" && e.startTime.slice(0, 10) === req.date,
    );

    let kickoff = req.kickoff || "19:00";
    let conditions = req.conditions;
    let assumedKickoff = !match && !req.kickoff;
    if (match) {
      const t = new Date(match.startTime);
      if (!Number.isNaN(t.getTime())) kickoff = t.toISOString().slice(11, 16);
      conditions = match.conditions || conditions;
      assumedKickoff = false;
    }

    const value = buildMatchDayPlan(profile, {
      date: req.date,
      kickoff,
      assumedKickoff,
      conditions,
      checkin,
    });
    return { ok: true, value };
  }
}
