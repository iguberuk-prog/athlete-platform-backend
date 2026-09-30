/**
 * Weekly parent reports: on screen any time, emailed on Sunday evenings.
 * The scheduled function calls sendDue(); records make it safe to run more
 * than once (each profile gets one email per week).
 */

import type { AthleteProfileRepository, CheckInRepository, RecordRepository } from "../data/repository.js";
import { buildWeeklyReport, reportEmail, type WeeklyReport } from "../domain/report.js";
import { featuresFor } from "../domain/features.js";
import type { FamilyService } from "./familyService.js";
import type { Mailer } from "./notifier.js";

export class ReportService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly mailer: Mailer,
  ) {}

  async weekly(userId: string, profileId: string, today: string): Promise<{ ok: true; value: WeeklyReport } | { ok: false; code: "not_found" }> {
    const owner = await this.family.ownerFor(userId, profileId);
    if (!owner) return { ok: false, code: "not_found" };
    const p = await this.profiles.getById(owner, profileId);
    if (!p) return { ok: false, code: "not_found" };
    const cis = await this.checkins.listByProfile(owner, profileId, 60);
    return { ok: true, value: buildWeeklyReport(p, cis, today) };
  }

  /** Send this week's reports that haven't gone out yet. Stops early to stay inside the time limit. */
  async sendDue(today: string, appUrl: string, budgetMs = 20_000): Promise<{ sent: number; skipped: number; remaining: boolean }> {
    const t0 = Date.now();
    let sent = 0, skipped = 0;
    for (const p of await this.profiles.listAll()) {
      if (Date.now() - t0 > budgetMs) return { sent, skipped, remaining: true };
      if (!featuresFor(p).on.weeklyParentReport || p.notifications?.weeklyReport === false) { skipped++; continue; }
      const id = `${p.id}:${today}`;
      if (await this.records.get("report", id)) continue;
      const to = await this.family.parentEmails(p);
      if (!to.length) { skipped++; continue; }
      const cis = await this.checkins.listByProfile(p.ownerId, p.id, 60);
      const email = reportEmail(buildWeeklyReport(p, cis, today), appUrl);
      const res = await this.mailer.send({ to, ...email });
      if (res.sent) {
        sent++;
        await this.records.put({ id, kind: "report", key: today, ownerId: p.ownerId, data: { to: to.length, emailId: res.id } });
      } else skipped++;
    }
    return { sent, skipped, remaining: false };
  }
}
