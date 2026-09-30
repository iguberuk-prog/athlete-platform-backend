/**
 * Insight endpoints (all GET, owner-scoped):
 *
 *   /api/profiles/:id/today      ?date=YYYY-MM-DD&now=YYYY-MM-DDTHH:MM
 *   /api/profiles/:id/recovery   ?date=YYYY-MM-DD&match=YYYY-MM-DD
 *   /api/profiles/:id/trends     ?date=YYYY-MM-DD&days=28
 *   /api/profiles/:id/grocery    ?from=YYYY-MM-DD&days=7
 *   /api/profiles/:id/reminders  ?from=YYYY-MM-DD&days=7&now=...&off=hydrate,sleep
 *   /api/profiles/:id/program    age program + food-safety summary
 *
 * Clients send their own local date so plans follow the athlete's clock.
 */

import type { Config, Context } from "@netlify/functions";
import { getInsightService, getFamilyService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, intParam, json, notFound, unauthorized, utcToday } from "../../src/http.js";
import type { ReminderPrefs } from "../../src/domain/reminders.js";

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const id = context.params?.id;
  if (!id) return json({ error: "profile id required in path" }, 400);
  const owner: string = (await getFamilyService().ownerFor(user.id, id)) ?? "__none__";

  const url = new URL(req.url);
  const kind = url.pathname.split("/").filter(Boolean).pop();
  const date = dateParam(url, "date", utcToday());
  const now = url.searchParams.get("now") || undefined;
  const svc = getInsightService();

  try {
    let result;
    switch (kind) {
      case "today":
        result = await svc.today(owner, id, date, now);
        break;
      case "recovery":
        result = await svc.recovery(owner, id, date, url.searchParams.get("match") || undefined);
        break;
      case "trends":
        result = await svc.trends(owner, id, date, intParam(url, "days", 28, 7, 60));
        break;
      case "grocery":
        result = await svc.grocery(owner, id, dateParam(url, "from", date), intParam(url, "days", 7, 1, 14));
        break;
      case "reminders": {
        const off = (url.searchParams.get("off") || "").split(",").filter(Boolean);
        const prefs: ReminderPrefs = Object.fromEntries(off.map((k) => [k, false]));
        result = await svc.reminders(owner, id, {
          from: dateParam(url, "from", date),
          days: intParam(url, "days", 7, 1, 14),
          now,
          prefs,
        });
        if (result.ok) return json({ reminders: result.value });
        break;
      }
      case "program":
        result = await svc.program(owner, id);
        break;
      default:
        return notFound();
    }
    return result.ok ? json(result.value) : notFound("Profile not found.");
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/today",
    "/api/profiles/:id/recovery",
    "/api/profiles/:id/trends",
    "/api/profiles/:id/grocery",
    "/api/profiles/:id/reminders",
    "/api/profiles/:id/program",
  ],
};
