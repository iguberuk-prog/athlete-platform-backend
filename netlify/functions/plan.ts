/**
 * HTTP entry point for the match-day plan.
 *
 *   GET /api/profiles/:id/plan?date=YYYY-MM-DD&kickoff=HH:MM&conditions=...
 *
 * Returns a personalized match-day fueling plan for the profile. date defaults
 * to today; kickoff/conditions are optional overrides used when no fixture is
 * on the schedule for that date.
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
  const conditions = url.searchParams.get("conditions") || undefined;

  try {
    const result = await getPlanService().matchDay(ownerId, id, { date, kickoff, conditions });
    return result.ok ? json(result.value) : json({ error: "not_found" }, 404);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/plan"],
};
