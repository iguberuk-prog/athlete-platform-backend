/**
 * Team hub (team coach, club staff, or families of rostered players):
 *
 *   GET    /api/teams/:teamId/hub
 *   POST   /api/teams/:teamId/announce { text, by? }         coach
 *   DELETE /api/teams/:teamId/announce/:itemId               coach
 *   POST   /api/teams/:teamId/challenges { type, start, end, title? }   coach
 *   POST   /api/teams/:teamId/challenges/:itemId/winners { message? }   coach
 *   POST   /api/teams/:teamId/homework { title, description?, videoUrl?, minutes?, due? }   coach
 *   POST   /api/teams/:teamId/homework/:itemId/done { profileId, date, note?, videoUrl? }    family
 *   POST   /api/teams/:teamId/signups { kind, title?, date, time?, slots }
 *   POST   /api/teams/:teamId/signups/:itemId { name, note?, release? }
 *   PUT    /api/teams/:teamId/feed { url | null }             coach: team calendar for every player
 */

import type { Config, Context } from "@netlify/functions";
import { getTeamHubService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "forbidden" ? 403 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const teamId = context.params?.teamId, item = context.params?.itemId || "";
  if (!teamId) return notFound();
  const svc = getTeamHubService();
  const url = new URL(req.url);
  const sub = url.pathname.split(`/api/teams/${teamId}`)[1] || "";
  try {
    const b = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
    let r;
    const route = `${req.method} ${item ? sub.replace(item, ":id") : sub}`;
    switch (route) {
      case "GET /hub": r = await svc.hub(user.id, teamId, dateParam(url, "date", utcToday())); break;
      case "POST /announce": r = await svc.announce(user.id, teamId, b.text, b.by); break;
      case "DELETE /announce/:id": r = await svc.deleteAnnouncement(user.id, teamId, item); break;
      case "POST /challenges": r = await svc.createChallenge(user.id, teamId, b as any); break;
      case "POST /challenges/:id/winners": r = await svc.announceWinners(user.id, teamId, item, b.message); break;
      case "POST /homework": r = await svc.createHomework(user.id, teamId, b as any); break;
      case "POST /homework/:id/done": r = await svc.completeHomework(user.id, teamId, item, b as any); break;
      case "POST /signups": r = await svc.createSignup(user.id, teamId, { ...b, slots: Number(b.slots) } as any); break;
      case "POST /signups/:id": r = await svc.takeSlot(user.id, teamId, item, b as any); break;
      case "PUT /feed": r = await svc.setFeed(user.id, teamId, b.url ? String(b.url) : null); break;
      case "POST /kitchen": r = await svc.createKitchen(user.id, teamId, b as any); break;
      case "GET /kitchen/:id": r = await svc.kitchenEntries(user.id, teamId, item); break;
      case "POST /kitchen/:id/entries": r = await svc.enterKitchen(user.id, teamId, item, b as any); break;
      case "POST /kitchen/:id/vote": r = await svc.voteKitchen(user.id, teamId, item, String(b.entryId || "")); break;
      case "DELETE /kitchen/:id/entries": r = await svc.removeKitchenEntry(user.id, teamId, item, String(url.searchParams.get("entry") || "")); break;
      default: return json({ error: "method_not_allowed" }, 405);
    }
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/teams/:teamId/hub", "/api/teams/:teamId/announce", "/api/teams/:teamId/announce/:itemId",
    "/api/teams/:teamId/challenges", "/api/teams/:teamId/challenges/:itemId/winners",
    "/api/teams/:teamId/homework", "/api/teams/:teamId/homework/:itemId/done",
    "/api/teams/:teamId/signups", "/api/teams/:teamId/signups/:itemId", "/api/teams/:teamId/feed",
    "/api/teams/:teamId/kitchen", "/api/teams/:teamId/kitchen/:itemId", "/api/teams/:teamId/kitchen/:itemId/entries", "/api/teams/:teamId/kitchen/:itemId/vote",
  ],
};
