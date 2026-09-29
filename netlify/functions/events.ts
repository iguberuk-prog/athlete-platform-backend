/**
 * HTTP entry point for a player's fixtures / scheduled events.
 *
 *   GET  /api/profiles/:id/events            list scheduled events (soonest first)
 *   POST /api/profiles/:id/events            append one or more events
 *        body: { events: [{ type, startTime, conditions?, importance? }, ...] }
 *   DELETE /api/profiles/:id/events?startTime=...&type=...&series=true
 *        remove one event, or a repeating series from that date on
 *
 * Used by the "Create Event" UI to add a single match/practice or a repeating
 * practice schedule (the client expands the recurrence into a list of events).
 */

import type { Config, Context } from "@netlify/functions";
import { verifyUser } from "../../src/auth.js";
import { errorResponse } from "../../src/http.js";
import { getProfileService } from "../../src/container.js";
import type { ScheduledEvent } from "../../src/domain/profile.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}


export default async (req: Request, context: Context): Promise<Response> => {
  const ownerId = (await verifyUser(req))?.id ?? null;
  if (!ownerId) {
    return json({ error: "unauthorized", message: "Please sign in." }, 401);
  }
  const id = context.params?.id;
  if (!id) return json({ error: "profile id required in path" }, 400);

  const service = getProfileService();

  try {
    if (req.method === "GET") {
      const result = await service.listEvents(ownerId, id);
      return result.ok ? json({ events: result.value }) : json({ error: "not_found" }, 404);
    }
    if (req.method === "POST") {
      const body = (await req.json()) as { events?: ScheduledEvent[] };
      const events = Array.isArray(body.events) ? body.events : [];
      const result = await service.addEvents(ownerId, id, events);
      if (result.ok) return json(result.value, 201);
      return result.code === "validation"
        ? json({ error: "validation_failed", details: result.errors }, 422)
        : json({ error: "not_found" }, 404);
    }
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const startTime = url.searchParams.get("startTime");
      if (!startTime) return json({ error: "startTime query parameter required" }, 400);
      const result = await service.removeEvents(ownerId, id, {
        startTime,
        type: url.searchParams.get("type") || undefined,
        series: url.searchParams.get("series") === "true",
      });
      return result.ok ? json(result.value) : json({ error: "not_found" }, 404);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/events"],
};
