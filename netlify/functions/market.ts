/**
 *   GET  /api/dietitians ?state=NJ                 approved registered dietitians
 *   POST /api/dietitians/apply                     a dietitian applies (reviewed by an admin)
 *   POST /api/dietitians/:dId/request { profileId, message?, times? }   family asks for a consult
 *   GET  /api/profiles/:id/camps                   camps and clinics matched to the player
 *   GET  /api/profiles/:id/club                    club branding, sponsor, on-call trainer, field closures
 *   DELETE /api/camps/:campId                      whoever posted it
 */

import type { Config, Context } from "@netlify/functions";
import { getClubService, getFamilyService, getMarketService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "forbidden" ? 403 : c === "inactive" ? 402 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const m = getMarketService();
  try {
    if (url.pathname === "/api/dietitians" && req.method === "GET") return json({ dietitians: await m.list(url.searchParams.get("state") || undefined) });
    const b = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
    let r;
    if (url.pathname === "/api/dietitians/apply" && req.method === "POST") r = await m.apply(user.id, user.email, b);
    else if (context.params?.dId && req.method === "POST") r = await m.requestBooking(user.id, user.email, { ...b, dietitianId: context.params.dId } as any);
    else if (context.params?.campId && req.method === "DELETE") r = await m.removeCamp(user.id, context.params.campId);
    else if (context.params?.id && url.pathname.endsWith("/club")) {
      const owner = await getFamilyService().ownerFor(user.id, context.params.id);
      if (!owner) return notFound();
      return json({ clubs: await getClubService().forProfile(owner, context.params.id) });
    } else if (context.params?.id && url.pathname.endsWith("/camps")) {
      const owner = await getFamilyService().ownerFor(user.id, context.params.id);
      if (!owner) return notFound();
      const clubs = await getClubService().forProfile(owner, context.params.id);
      const camps = await m.campsFor(user.id, context.params.id, dateParam(url, "date", utcToday()), clubs.map((c) => c.id));
      return camps ? json({ camps }) : notFound();
    } else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/dietitians", "/api/dietitians/apply", "/api/dietitians/:dId/request", "/api/profiles/:id/camps", "/api/profiles/:id/club", "/api/camps/:campId"],
};
