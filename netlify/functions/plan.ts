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
import { getPlanService } from "../../src/container.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getOwnerId(req: Request): string | null {
  const id = req.headers.get("x-owner-id");
  return id && id.trim() ? id.trim() : null;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    return json({ error: "missing x-owner-id header (stands in for authentication)" }, 401);
  }
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const id = context.params?.id;
  if (!id) return json({ error: "profile id required in path" }, 400);

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const kickoff = url.searchParams.get("kickoff") || undefined;
  const conditions = url.searchParams.get("conditions") || undefined;

  try {
    const result = await getPlanService().matchDay(ownerId, id, { date, kickoff, conditions });
    return result.ok ? json(result.value) : json({ error: "not_found" }, 404);
  } catch (err) {
    const e = err as Error & { cause?: { message?: string } };
    const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
    return json({ error: "bad_request", message: detail }, 400);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/plan"],
};
