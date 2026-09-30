/**
 * Scheduled: Sunday evenings. Emails each linked parent a weekly report for
 * players under 18 (unless turned off). Runs hourly 22:00-01:00 UTC on
 * Sunday/Monday so a big batch finishes across runs; each profile gets one
 * email per week.
 */

import type { Config } from "@netlify/functions";
import { getReportService } from "../../src/container.js";

export default async (): Promise<Response> => {
  // "Today" is the Sunday the report covers, in US time.
  const now = new Date(Date.now() - 6 * 3_600_000);
  const today = now.toISOString().slice(0, 10);
  const appUrl = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "") + "/#/report";
  try {
    const r = await getReportService().sendDue(today, appUrl, 22_000);
    console.log(`weekly-report ${today}: sent ${r.sent}, skipped ${r.skipped}, more: ${r.remaining}`);
  } catch (err) {
    console.error("weekly-report failed", err);
  }
  return new Response("ok");
};

export const config: Config = { schedule: "0 22,23 * * 0" };
