/**
 * Family links (parent <-> player accounts):
 *
 *   GET    /api/profiles/:id/family                 who else can see this profile
 *   POST   /api/profiles/:id/family/invite { role }   owner makes a code ("parent" or "athlete")
 *   DELETE /api/profiles/:id/family/:userId         owner removes someone, or you remove yourself
 *   POST   /api/family/redeem { code }              enter a code to link
 */

import type { Config, Context } from "@netlify/functions";
import { getFamilyService } from "../../src/container.js";
import { currentUser, errorResponse, json, notFound, unauthorized } from "../../src/http.js";

const fail = (r: { code: string; message?: string }) =>
  json({ error: r.code, message: r.message }, r.code === "not_found" ? 404 : r.code === "forbidden" ? 403 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const svc = getFamilyService();
  const url = new URL(req.url);
  const id = context.params?.id;
  try {
    if (url.pathname === "/api/family/redeem" && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { code?: string };
      const r = await svc.redeem(user.id, user.email, b.code || "");
      return r.ok ? json(r.value) : fail(r);
    }
    if (!id) return notFound();
    if (url.pathname.endsWith("/invite") && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { role?: "parent" | "athlete" };
      const r = await svc.createInvite(user.id, id, b.role || "parent");
      return r.ok ? json(r.value, 201) : fail(r);
    }
    const target = context.params?.userId === "me" ? user.id : context.params?.userId;
    if (target && req.method === "DELETE") {
      const r = await svc.unlink(user.id, id, target);
      return r.ok ? new Response(null, { status: 204 }) : fail(r);
    }
    if (req.method === "GET") {
      const r = await svc.links(user.id, id);
      return r.ok ? json({ links: r.value }) : fail(r);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/family/redeem", "/api/profiles/:id/family", "/api/profiles/:id/family/invite", "/api/profiles/:id/family/:userId"],
};
