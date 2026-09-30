/** Scheduled 7 AM and 1 PM Eastern: heat, storm and air alerts for club fields, emailed to staff and posted to teams. */

import type { Config } from "@netlify/functions";
import { getClubService } from "../../src/container.js";

export default async (): Promise<Response> => {
  const today = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
  try {
    const n = await getClubService().sendFieldAlerts(today, 22_000);
    console.log(`field-alerts ${today}: ${n} clubs alerted`);
  } catch (err) {
    console.error("field-alerts failed", err);
  }
  return new Response("ok");
};

export const config: Config = { schedule: "5 11,17 * * *" };
