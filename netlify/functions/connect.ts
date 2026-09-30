/**
 * Connect team apps:
 *   GET    /api/profiles/:id/connect                        every app, what's connected, feeds, next events
 *   POST   /api/profiles/:id/connect/:provider/start         -> { url } to the provider's sign-in page
 *   GET    /api/profiles/:id/connect/:provider/options       teams (TeamSnap) or calendars (Google) to pick
 *   POST   /api/profiles/:id/connect/:provider/choose        { picks: [{id,name}], keywords? }
 *   DELETE /api/profiles/:id/connect/:provider               sign out and remove its events
 *   GET    /api/connect/:provider/callback                   provider redirect (uses state)
 * provider = teamsnap | google. Calendar links (every other app) use /api/profiles/:id/calendars.
 */

import type { Config, Context } from "@netlify/functions";
import { getConnectService } from "../../src/container.js";
import { currentUser, errorResponse, json, notFound, unauthorized } from "../../src/http.js";
import type { SignIn } from "../../src/services/connectService.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "not_configured" ? 501 : c === "not_connected" ? 409 : c === "failed" ? 502 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const svc = getConnectService();
  try {
    const provider = context.params?.provider as SignIn | undefined;
    if (provider && !["teamsnap", "google"].includes(provider)) return notFound();
    if (url.pathname.startsWith("/api/connect/") && url.pathname.endsWith("/callback")) {
      const to = await svc.callback(provider!, url.searchParams.get("code"), url.searchParams.get("state"), url.searchParams.get("error"));
      return new Response(null, { status: 302, headers: { Location: to } });
    }
    const user = await currentUser(req);
    if (!user) return unauthorized();
    const id = context.params?.id;
    if (!id) return notFound();
    const tail = url.pathname.split(`/api/profiles/${id}/connect`)[1] || "";
    let r;
    if (req.method === "GET" && !tail) r = await svc.overview(user.id, id);
    else if (provider && req.method === "POST" && tail.endsWith("/start")) r = await svc.start(user.id, id, provider);
    else if (provider && req.method === "GET" && tail.endsWith("/options")) r = await svc.options(user.id, id, provider);
    else if (provider && req.method === "POST" && tail.endsWith("/choose")) {
      const b = (await req.json().catch(() => ({}))) as { picks?: { id: string; name: string }[]; keywords?: string[] };
      r = await svc.choose(user.id, id, provider, b.picks || [], b.keywords);
    } else if (provider && req.method === "DELETE" && tail === `/${provider}`) r = await svc.disconnect(user.id, id, provider);
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/connect", "/api/profiles/:id/connect/:provider", "/api/profiles/:id/connect/:provider/start",
    "/api/profiles/:id/connect/:provider/options", "/api/profiles/:id/connect/:provider/choose", "/api/connect/:provider/callback",
  ],
};
