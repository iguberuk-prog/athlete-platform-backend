/**
 * Account service: full data deletion for an account.
 *
 * Apple requires apps with sign-up to offer account deletion inside the app.
 * This removes every profile, check-in, team and membership the account owns.
 * The HTTP layer then deletes the login itself from Supabase Auth.
 */

import type { AthleteProfileRepository, CheckInRepository, TeamRepository } from "../data/repository.js";

export interface DeletionReport {
  profiles: number;
  checkins: number;
}

export class AccountService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly teams: TeamRepository,
  ) {}

  async deleteAllData(ownerId: string): Promise<DeletionReport> {
    await this.teams.deleteAllForOwner(ownerId);
    const list = await this.profiles.listByOwner(ownerId);
    let checkins = 0;
    for (const p of list) {
      checkins += await this.checkins.deleteByProfile(ownerId, p.id);
      await this.profiles.delete(ownerId, p.id);
    }
    return { profiles: list.length, checkins };
  }
}
