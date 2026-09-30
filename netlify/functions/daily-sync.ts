/**
 * Scheduled: every day at 09:20 UTC (early morning in the US), re-sync team
 * calendars and wearables. Runs inside Netlify's 30-second limit by working
 * through a time budget; anything left is picked up the next day or when the
 * player opens the app.
 */

import type { Config } from "@netlify/functions";
import { getCalendarService, getIntegrationService, getTeamHubService } from "../../src/container.js";
import { getProfileService } from "../../src/container.js";

export default async (): Promise<Response> => {
  const t0 = Date.now();
  let calendars = 0;
  try {
    const cal = getCalendarService();
    for (const p of await getProfileService().listAll()) {
      if (Date.now() - t0 > 12_000) break;
      if (!(p.schedule?.feeds || []).length) continue;
      await cal.syncProfile(p.ownerId, p).catch(() => null);
      calendars++;
    }
    const teamFeeds = await getTeamHubService().syncAllFeeds(6_000);
    console.log(`daily-sync: ${teamFeeds} team calendars`);
    const devices = await getIntegrationService().syncAll(Math.max(2_000, 24_000 - (Date.now() - t0)));
    console.log(`daily-sync: ${calendars} calendars, ${devices} devices`);
  } catch (err) {
    console.error("daily-sync failed", err);
  }
  return new Response("ok");
};

export const config: Config = { schedule: "20 9 * * *" };
