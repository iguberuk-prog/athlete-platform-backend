/**
 * Clubs (staff only unless noted):
 *
 *   GET  /api/clubs                                my clubs and roles
 *   POST /api/clubs { name, referral? }            start a club (you become director); 30-day trial
 *   POST /api/clubs/join { code, name? }           join as staff with a code from the director
 *   GET  /api/clubs/:clubId                        club + teams
 *   PUT  /api/clubs/:clubId                        director: name, logo, colors, sponsor
 *   POST /api/clubs/:clubId/invite { role }        director: staff code (director, coach, trainer)
 *   GET  /api/clubs/:clubId/staff                  staff, certifications
 *   PUT  /api/clubs/:clubId/staff/me               your contact, certifications, on-call
 *   DELETE /api/clubs/:clubId/staff/:userId        director
 *   GET/POST /api/clubs/:clubId/teams              list / create or add a team
 *   GET  /api/clubs/:clubId/dashboard              director, trainer
 *   GET  /api/clubs/:clubId/medical                director (safety view), trainer (full)
 *   GET  /api/clubs/:clubId/concussions            director, trainer
 *   POST /api/clubs/:clubId/clear { profileId, date }   trainer: return-to-play clearance
 *   POST /api/clubs/:clubId/fields                 add (director), update status (director/coach), remove (director)
 *   POST /api/clubs/:clubId/billing/checkout { seats }  director
 *   POST /api/clubs/:clubId/billing/portal         director
 *   POST /api/clubs/:clubId/camps                  director: post a camp or clinic
 */

import type { Config, Context } from "@netlify/functions";
import { getBillingService, getClubService, getMarketService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "forbidden" ? 403 : c === "inactive" ? 402 : c === "not_configured" ? 501 : c === "failed" ? 502 : 422);
const out = (r: { ok: boolean; value?: unknown; code?: string; message?: string }, ok = 200) => (r.ok ? json(r.value, ok) : json({ error: r.code, message: r.message }, status(r.code!)));

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const svc = getClubService();
  const url = new URL(req.url);
  const clubId = context.params?.clubId;
  const sub = clubId ? url.pathname.split(`/api/clubs/${clubId}`)[1] || "" : "";
  const today = dateParam(url, "date", utcToday());
  try {
    const b = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
    if (url.pathname === "/api/clubs") {
      if (req.method === "GET") return json({ clubs: await svc.mine(user.id) });
      if (req.method === "POST") return out(await svc.create(user.id, user.email, b.name, b.referral), 201);
    }
    if (url.pathname === "/api/clubs/join" && req.method === "POST") return out(await svc.join(user.id, user.email, b.code, b.name));
    if (!clubId) return notFound();
    switch (`${req.method} ${sub.replace(/\/staff\/(?!me$)[^/]+$/, "/staff/:user")}`) {
      case "GET ": return out(await svc.get(user.id, clubId));
      case "PUT ": return out(await svc.update(user.id, clubId, b));
      case "POST /invite": return out(await svc.invite(user.id, clubId, b.role), 201);
      case "GET /staff": return out(await svc.staffList(user.id, clubId, today));
      case "PUT /staff/me": return out(await svc.updateMe(user.id, clubId, b));
      case "DELETE /staff/:user": return out(await svc.removeStaff(user.id, clubId, context.params?.userId || ""));
      case "GET /teams": { const r = await svc.get(user.id, clubId); return r.ok ? json({ teams: r.value.teams }) : out(r); }
      case "POST /teams": return out(await svc.addTeam(user.id, clubId, b), 201);
      case "GET /dashboard": return out(await svc.dashboard(user.id, clubId, today));
      case "GET /medical": return out(await svc.medicalRoster(user.id, clubId));
      case "GET /concussions": return out(await svc.concussionLog(user.id, clubId));
      case "POST /clear": return out(await svc.trainerClear(user.id, clubId, b.profileId, b.date));
      case "POST /fields": return out(await svc.setField(user.id, clubId, b));
      case "POST /billing/checkout": return out(await getBillingService().checkout(user.id, clubId, Number(b.seats)));
      case "POST /billing/portal": return out(await getBillingService().portal(user.id, clubId));
      case "POST /camps": return out(await getMarketService().addCamp(user.id, { ...b, clubId }), 201);
      default: return json({ error: "method_not_allowed" }, 405);
    }
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/clubs", "/api/clubs/join", "/api/clubs/:clubId", "/api/clubs/:clubId/invite",
    "/api/clubs/:clubId/staff", "/api/clubs/:clubId/staff/me", "/api/clubs/:clubId/staff/:userId",
    "/api/clubs/:clubId/teams", "/api/clubs/:clubId/dashboard", "/api/clubs/:clubId/medical", "/api/clubs/:clubId/concussions",
    "/api/clubs/:clubId/clear", "/api/clubs/:clubId/fields", "/api/clubs/:clubId/billing/checkout", "/api/clubs/:clubId/billing/portal",
    "/api/clubs/:clubId/camps",
  ],
};
