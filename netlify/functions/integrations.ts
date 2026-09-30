/**
 * Wearables:
 *
 *   GET    /api/profiles/:id/integrations                         devices + status
 *   POST   /api/profiles/:id/integrations/:provider/start         -> { url } to open
 *   POST   /api/profiles/:id/integrations/:provider/sync
 *   DELETE /api/profiles/:id/integrations/:provider
 *   GET    /api/integrations/:provider/callback ?code&state        provider redirect (no login header; uses state)
 *   POST   /api/profiles/:id/plate { image: dataUrl }              snap-a-plate photo analysis
 */

import type { Config, Context } from "@netlify/functions";
import { getIntegrationService, getPlateService } from "../../src/container.js";
import { isProvider } from "../../src/services/integrationService.js";
import { currentUser, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const status = (code: string) => (code === "not_found" ? 404 : code === "age" ? 403 : code === "limit" ? 429 : code === "not_configured" ? 501 : code === "failed" ? 502 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const provider = context.params?.provider;
  const svc = getIntegrationService();
  try {
    if (url.pathname.startsWith("/api/integrations/") && url.pathname.endsWith("/callback")) {
      if (!isProvider(provider)) return notFound();
      const to = await svc.callback(provider, url.searchParams.get("code"), url.searchParams.get("state"), url.searchParams.get("error"));
      return new Response(null, { status: 302, headers: { Location: to } });
    }
    const user = await currentUser(req);
    if (!user) return unauthorized();
    const id = context.params?.id;
    if (!id) return notFound();
    if (url.pathname.endsWith("/plate") && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { image?: string; date?: string };
      const r = await getPlateService().analyze(user.id, id, String(b.image || ""), /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date! : utcToday());
      return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
    }
    if (!provider) {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const r = await svc.list(user.id, id);
      return r.ok ? json(r.value) : notFound();
    }
    if (!isProvider(provider)) return notFound();
    let r;
    if (req.method === "POST" && url.pathname.endsWith("/start")) r = await svc.start(user.id, id, provider);
    else if (req.method === "POST" && url.pathname.endsWith("/sync")) r = await svc.sync(user.id, id, provider, 7);
    else if (req.method === "DELETE") r = await svc.disconnect(user.id, id, provider);
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/integrations",
    "/api/profiles/:id/integrations/:provider",
    "/api/profiles/:id/integrations/:provider/start",
    "/api/profiles/:id/integrations/:provider/sync",
    "/api/integrations/:provider/callback",
    "/api/profiles/:id/plate",
  ],
};
