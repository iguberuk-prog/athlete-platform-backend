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
    const e = err as Error & { cause?: { message?: string } };
    const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
    return json({ error: "bad_request", message: detail }, 400);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/timeline"],
};
