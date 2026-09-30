/**
 * Admin (x-admin-key = ADMIN_KEY):
 *   GET  /api/admin/dietitians                     pending applications
 *   POST /api/admin/dietitians/:dId { status }     approve or reject
 *   POST /api/admin/camps                          post a public camp
 */

import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getMarketService } from "../../src/container.js";
import { errorResponse, json } from "../../src/http.js";

const ok = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async (req: Request, context: Context): Promise<Response> => {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return json({ error: "admin_not_configured" }, 503);
  if (!ok(req.headers.get("x-admin-key") || "", expected)) return json({ error: "forbidden" }, 403);
  const m = getMarketService();
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/admin/dietitians" && req.method === "GET") return json({ pending: await m.pending() });
    const b = (await req.json().catch(() => ({}))) as Record<string, any>;
    let r;
    if (context.params?.dId && req.method === "POST") r = await m.review(context.params.dId, b.status === "approved" ? "approved" : "rejected");
    else if (url.pathname === "/api/admin/camps" && req.method === "POST") r = await m.addCamp("admin", b, true);
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, 422);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ["/api/admin/dietitians", "/api/admin/dietitians/:dId", "/api/admin/camps"] };
