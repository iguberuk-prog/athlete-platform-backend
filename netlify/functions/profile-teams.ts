/**
 * A player's team memberships (owner of the profile only):
 *
 *   GET    /api/profiles/:id/teams                 teams this profile is on
 *   POST   /api/profiles/:id/teams   { code }      join a team with the coach's code
 *   DELETE /api/profiles/:id/teams/:teamId         leave a team
 */

import type { Config, Context } from "@netlify/functions";
import { getTeamService } from "../../src/container.js";
import { currentUser, errorResponse, json, unauthorized } from "../../src/http.js";

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const id = context.params?.id;
  const teamId = context.params?.teamId;
  if (!id) return json({ error: "profile id required in path" }, 400);
  const svc = getTeamService();

  try {
    if (req.method === "GET" && !teamId) {
      const r = await svc.teamsForProfile(user.id, id);
      return r.ok ? json({ teams: r.value }) : json({ error: "not_found" }, 404);
    }
    if (req.method === "POST" && !teamId) {
      const body = (await req.json().catch(() => ({}))) as { code?: string };
      const r = await svc.join(user.id, id, body.code || "");
      if (r.ok) return json({ team: { id: r.value.id, name: r.value.name } }, 201);
      return json({ error: r.code, message: r.message }, r.code === "invalid" ? 422 : 404);
    }
    if (req.method === "DELETE" && teamId) {
      const r = await svc.leave(user.id, id, teamId);
      return r.ok ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/teams", "/api/profiles/:id/teams/:teamId"],
};
