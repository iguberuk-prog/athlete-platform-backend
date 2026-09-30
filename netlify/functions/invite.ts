/**
 * Invite a friend:
 *   GET  /api/invite ?from=Name        my code, link, message, joined count
 *   POST /api/invite/email { to, from, note }   email the invite (Resend)
 *   POST /api/invite/redeem { code }    a new account arrived through an invite
 *   GET  /api/invite/lookup ?code=      public: is the code real, store links
 */

import type { Config } from "@netlify/functions";
import { getInviteService } from "../../src/container.js";
import { currentUser, errorResponse, json, unauthorized, utcToday } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "limit" ? 429 : c === "not_configured" ? 501 : 422);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const svc = getInviteService();
  try {
    if (url.pathname === "/api/invite/lookup") return json(await svc.lookup(url.searchParams.get("code") || ""));
    const user = await currentUser(req);
    if (!user) return unauthorized();
    if (req.method === "GET" && url.pathname === "/api/invite") return json(await svc.mine(user.id, url.searchParams.get("from") || undefined));
    const b = (await req.json().catch(() => ({}))) as Record<string, any>;
    let r;
    if (req.method === "POST" && url.pathname === "/api/invite/email") r = await svc.email(user.id, user.email, b, /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : utcToday());
    else if (req.method === "POST" && url.pathname === "/api/invite/redeem") r = await svc.redeem(user.id, String(b.code || ""));
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ["/api/invite", "/api/invite/email", "/api/invite/redeem", "/api/invite/lookup"] };
