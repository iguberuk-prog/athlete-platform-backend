/**
 * Claimable roster invites (bulk onboarding).
 *
 *   GET  /api/claim/:token           public: name + team prefill for the invite link
 *   POST /api/claim/:token/redeem    signed-in: auto-join the caller's profile to the team
 *
 * The club bulk-imports a roster; each row gets a one-time token emailed to the
 * family. This endpoint lets the family read what they were invited to (no health
 * data) and, after creating their profile, redeem the token to auto-join the team.
 */

import type { Config, Context } from "@netlify/functions";
import { getClubService } from "../../src/container.js";
import { currentUser, errorResponse, json, notFound, unauthorized } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "forbidden" ? 403 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const token = context.params?.token || "";
  const svc = getClubService();
  try {
    const redeem = new URL(req.url).pathname.endsWith("/redeem");
    if (req.method === "GET" && !redeem) {
      const info = await svc.claimInfo(token);
      return info ? json(info) : notFound();
    }
    if (req.method === "POST" && redeem) {
      const user = await currentUser(req);
      if (!user) return unauthorized();
      const b = (await req.json().catch(() => ({}))) as { profileId?: string };
      const r = await svc.redeemClaim(user.id, b.profileId || "", token);
      return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code!));
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ["/api/claim/:token", "/api/claim/:token/redeem"] };
