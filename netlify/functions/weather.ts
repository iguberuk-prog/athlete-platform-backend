/**
 * GET /api/weather/:zip   (signed-in only)
 *
 * Confirms a ZIP code and returns the place name plus the next 12 hours,
 * so the app can show "07039: Roseland, NJ, 72°F" while a ZIP is entered.
 */

import type { Config, Context } from "@netlify/functions";
import { currentUser, errorResponse, json, unauthorized } from "../../src/http.js";
import { DemoProvider, isKnownZip, NwsProvider } from "../../src/weather/nws.js";
import { heatFlag } from "../../src/domain/weather.js";

const provider = process.env.WEATHER === "demo" && process.env.DB_BACKEND !== "supabase" ? new DemoProvider() : new NwsProvider();

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const zip = String(context.params?.zip || "");
  if (!/^\d{5}$/.test(zip)) return json({ error: "invalid_zip", message: "Enter a 5-digit ZIP code." }, 422);
  if (!isKnownZip(zip)) return json({ error: "unknown_zip", message: "We couldn't find that ZIP code." }, 404);
  try {
    const f = process.env.WEATHER === "off" ? null : await provider.forecast(zip);
    if (!f) return json({ zip, known: true, place: null, next12: [] });
    const next12 = f.hours.slice(0, 12).map((h) => ({ ...h, heat: heatFlag(h.wbgtF) }));
    return json({ zip, known: true, place: f.place, timeZone: f.timeZone, next12 });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ["/api/weather/:zip"] };
