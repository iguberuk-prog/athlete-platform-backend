/**
 * HTTP entry point for the game-day timeline.
 *
 *   GET /api/profiles/:id/timeline
 *       ?date=YYYY-MM-DD&kickoff=HH:MM&wake=HH:MM&bed=HH:MM
 *       &conditions=...&playsTomorrow=true|false
 *
 * Returns a clock-anchored schedule from wake-up to bedtime, including a night
 * routine and (when relevant) a "plays tomorrow" hook + calendar-ready events.
 */

import type { Config, Context } from "@netlify/functions";
import { verifyUser } from "../../src/auth.js";
import { errorResponse } from "../../src/http.js";
import { getPlanService, getFamilyService } from "../../src/container.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}


export default async (req: Request, context: Context): Promise<Response> => {
  const userId = (await verifyUser(req))?.id ?? null;
  if (!userId) {
    return json({ error: "unauthorized", message: "Please sign in." }, 401);
  }
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const id = context.params?.id;
  if (!id) return json({ error: "profile id required in path" }, 400);
  // The owner, or a linked parent/player (family link). Unknown -> not found.
  const ownerId = (await getFamilyService().ownerFor(userId, id)) ?? "__none__";

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const kickoff = url.searchParams.get("kickoff") || undefined;
  const wakeTime = url.searchParams.get("wake") || undefined;
  const bedTime = url.searchParams.get("bed") || undefined;
  const conditions = url.searchParams.get("conditions") || undefined;
  const pt = url.searchParams.get("playsTomorrow");
  const playsTomorrow = pt === null ? undefined : pt === "true";

  try {
    const result = await getPlanService().timeline(ownerId, id, {
      date, kickoff, wakeTime, bedTime, conditions, playsTomorrow,
    });
    return result.ok ? json(result.value) : json({ error: "not_found" }, 404);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/timeline"],
};
