/**
 * Player health endpoints (owner or linked family):
 *
 *   GET  /api/profiles/:id/health ?date=&viewer=parent     alerts + all health sections
 *   POST /api/profiles/:id/health/sweat-test  { date, preKg, postKg, fluidL, urineL?, minutes, tempF? }
 *   POST /api/profiles/:id/health/height      { date, heightCm }
 *   POST /api/profiles/:id/health/concussion  { date, notes? }        start return-to-play
 *   POST /api/profiles/:id/health/concussion/step  { date, symptoms }
 *   POST /api/profiles/:id/health/concussion/clear { date, clearedBy } provider's written clearance
 */

import type { Config, Context } from "@netlify/functions";
import { getHealthService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const fail = (r: { code: string; message?: string }) =>
  json({ error: r.code, message: r.message }, r.code === "not_found" ? 404 : r.code === "age" ? 403 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const id = context.params?.id;
  if (!id) return notFound();
  const url = new URL(req.url);
  const svc = getHealthService();
  const sub = url.pathname.split("/health")[1] || "";
  try {
    if (req.method === "GET" && !sub) {
      const viewer = url.searchParams.get("viewer") === "parent" ? "parent" : undefined;
      const r = await svc.status(user.id, id, dateParam(url, "date", utcToday()), viewer);
      return r.ok ? json(r.value) : notFound("Profile not found.");
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const b = (await req.json().catch(() => ({}))) as Record<string, any>;
    let r;
    switch (sub) {
      case "/sweat-test": r = await svc.addSweatTest(user.id, id, b as any); break;
      case "/height": r = await svc.addHeight(user.id, id, b.date, Number(b.heightCm)); break;
      case "/concussion": r = await svc.reportConcussion(user.id, id, b.date, b.notes); break;
      case "/concussion/step": r = await svc.concussionStep(user.id, id, b.date, !!b.symptoms); break;
      case "/concussion/clear": r = await svc.clearConcussion(user.id, id, b.date, b.clearedBy); break;
      default: return notFound();
    }
    return r.ok ? json(r.value) : fail(r);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/health",
    "/api/profiles/:id/health/sweat-test",
    "/api/profiles/:id/health/height",
    "/api/profiles/:id/health/concussion",
    "/api/profiles/:id/health/concussion/step",
    "/api/profiles/:id/health/concussion/clear",
  ],
};
