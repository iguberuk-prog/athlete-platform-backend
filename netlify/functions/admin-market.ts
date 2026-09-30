/**
 * Admin (x-admin-key = ADMIN_KEY):
 *   GET  /api/admin/dietitians                     pending applications
 *   POST /api/admin/dietitians/:dId { status }     approve or reject
 *   POST /api/admin/camps                          post a public camp
 *   GET  /api/admin/vendors                        paid product placements
 *   POST /api/admin/vendors { brand, product, replaces, allergens?, gluten?, animal?, ..., active, start?, end?, url? }
 *   DELETE /api/admin/vendors/:vId
 * Placements only show when VENDOR_PLACEMENTS=on, and never to a player they're unsafe for.
 */

import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getMarketService, getRecordRepository } from "../../src/container.js";
import { randomUUID } from "node:crypto";
import { food } from "../../src/domain/foods.js";
import type { VendorProduct } from "../../src/domain/recipes.js";
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
    if (url.pathname.startsWith("/api/admin/vendors")) return vendors(req, context);
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

async function vendors(req: Request, context: Context): Promise<Response> {
  const recs = getRecordRepository();
  if (req.method === "GET") return json({ enabled: process.env.VENDOR_PLACEMENTS === "on", vendors: (await recs.listByKind("vendor", 500)).map((v) => v.data) });
  if (req.method === "DELETE" && context.params?.vId) return json({ removed: await recs.delete("vendor", context.params.vId) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  if (!text(b.brand, 60) || !text(b.product, 80) || !food(text(b.replaces, 40))) return json({ error: "invalid", message: "brand, product and replaces (a catalog food id) are required" }, 422);
  if (!Array.isArray(b.allergens)) return json({ error: "invalid", message: "List the product's allergens (an empty list if none) so safety rules can check it." }, 422);
  const v: VendorProduct = {
    id: text(b.id, 40) || randomUUID(), brand: text(b.brand, 60), product: text(b.product, 80), replaces: text(b.replaces, 40),
    allergens: b.allergens.map((a: unknown) => text(a, 20)), mayContain: Array.isArray(b.mayContain) ? b.mayContain.map((a: unknown) => text(a, 20)) : [],
    animal: !!b.animal, meat: !!b.meat, pork: !!b.pork, redMeat: !!b.redMeat, fish: !!b.fish, shellfish: !!b.shellfish, lactose: !!b.lactose,
    gluten: !!b.gluten, gelatin: !!b.gelatin, caffeine: !!b.caffeine, highFodmap: !!b.highFodmap, heavy: !!b.heavy, minAge: Number(b.minAge) || undefined,
    url: typeof b.url === "string" && /^https:\/\//.test(b.url) ? b.url.slice(0, 300) : undefined,
    active: !!b.active, start: typeof b.start === "string" ? b.start.slice(0, 10) : undefined, end: typeof b.end === "string" ? b.end.slice(0, 10) : undefined,
  };
  await recs.put({ id: v.id, kind: "vendor", key: v.replaces, ownerId: "admin", data: v });
  return json(v, 201);
}

export const config: Config = { path: ["/api/admin/dietitians", "/api/admin/dietitians/:dId", "/api/admin/camps", "/api/admin/vendors", "/api/admin/vendors/:vId"] };
