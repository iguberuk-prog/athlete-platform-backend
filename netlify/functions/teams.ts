/**
 * Coach team endpoints:
 *
 *   GET    /api/teams                              teams I coach (with player counts)
 *   POST   /api/teams            { name }          create a team, returns its join code
 *   DELETE /api/teams/:teamId                      delete a team I coach
 *   GET    /api/teams/:teamId/roster ?date=        roster view (coach only)
 *   DELETE /api/teams/:teamId/members/:profileId   remove a player (coach only)
 */

import type { Config, Context } from "@netlify/functions";
import { getClubService, getTeamService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, unauthorized, utcToday } from "../../src/http.js";

function fail(code: string, message?: string): Response {
  const status = code === "forbidden" ? 403 : code === "invalid" ? 422 : 404;
  return json({ error: code, message }, status);
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const svc = getTeamService();
  const teamId = context.params?.teamId;
  const profileId = context.params?.profileId;
  const url = new URL(req.url);
  const isRoster = url.pathname.endsWith("/roster");
  // Club staff (director, coach, trainer) can open any team in their club.
  const asCoach = async (): Promise<string> => {
    if (!teamId) return user.id;
    const club = await getClubService().clubForTeam(teamId);
    if (club && (await getClubService().staff(club.id, user.id))) {
      const t = await getClubService().teamById(teamId);
      if (t) return t.coachOwnerId;
    }
    return user.id;
  };
  const isSub = /\/(dashboard|meal)$/.test(url.pathname);

  try {
    if (!teamId) {
      if (req.method === "GET") return json({ teams: await svc.listMine(user.id) });
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { name?: string };
        const r = await svc.create(user.id, body.name || "");
        return r.ok ? json(r.value, 201) : fail(r.code, r.message);
      }
      return json({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname.endsWith("/dashboard") && req.method === "GET") {
      const r = await svc.dashboard(await asCoach(), teamId, dateParam(url, "date", utcToday()));
      return r.ok ? json(r.value) : fail(r.code, (r as { message?: string }).message);
    }
    if (url.pathname.endsWith("/meal") && req.method === "GET") {
      const r = await svc.meal(await asCoach(), teamId, url.searchParams.get("gameDay") === "1");
      return r.ok ? json(r.value) : fail(r.code, r.message);
    }
    if (isRoster && req.method === "GET") {
      const r = await svc.roster(await asCoach(), teamId, dateParam(url, "date", utcToday()));
      return r.ok ? json(r.value) : fail(r.code, r.message);
    }
    if (profileId && req.method === "DELETE") {
      const r = await svc.removePlayer(user.id, teamId, profileId);
      return r.ok ? new Response(null, { status: 204 }) : fail(r.code, r.message);
    }
    if (!profileId && !isRoster && !isSub && req.method === "DELETE") {
      const r = await svc.remove(user.id, teamId);
      return r.ok ? new Response(null, { status: 204 }) : fail(r.code, r.message);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/teams", "/api/teams/:teamId", "/api/teams/:teamId/roster", "/api/teams/:teamId/dashboard", "/api/teams/:teamId/meal", "/api/teams/:teamId/members/:profileId"],
};
