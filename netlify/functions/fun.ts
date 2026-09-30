/**
 * Fun layer:
 *   GET    /api/profiles/:id/fun/kids ?now=         buddy, sticker book, tonight's story (12 and under)
 *   PUT    /api/profiles/:id/fun/settings            { name?, color?, genres? }
 *   POST   /api/profiles/:id/fun/log                 { kind: story|quiz|chef, date, score? }
 *   GET    /api/profiles/:id/fun/quiz ?seed=
 *   GET    /api/profiles/:id/fun/hunt ?from=
 *   GET    /api/profiles/:id/fun/wrapped              season wrapped (13+)
 *   GET    /api/profiles/:id/fun/playlist ?now=       pre-game playlist plan (13+)
 *   POST   /api/profiles/:id/fun/spotify/start | /build
 *   DELETE /api/profiles/:id/fun/spotify
 *   GET    /api/spotify/callback                      Spotify redirect (uses state)
 *   GET    /api/family/cook-night ?seed=               one dinner for the whole family, jobs by age
 *   POST   /api/family/cook-night/done { date }
 */

import type { Config, Context } from "@netlify/functions";
import { getFunService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";

const status = (c: string) => (c === "not_found" ? 404 : c === "age" ? 403 : c === "not_configured" ? 501 : c === "failed" ? 502 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const svc = getFunService();
  try {
    if (url.pathname === "/api/spotify/callback") {
      const to = await svc.spotifyCallback(url.searchParams.get("code"), url.searchParams.get("state"), url.searchParams.get("error"));
      return new Response(null, { status: 302, headers: { Location: to } });
    }
    const user = await currentUser(req);
    if (!user) return unauthorized();
    const today = dateParam(url, "date", utcToday());
    const now = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(url.searchParams.get("now") || "") ? url.searchParams.get("now")!.slice(0, 16) : new Date().toISOString().slice(0, 16);
    const seed = Math.abs(Number(url.searchParams.get("seed")) || 0);
    const b = req.method === "GET" || req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
    let r;
    if (url.pathname === "/api/family/cook-night" && req.method === "GET") r = await svc.cookNight(user.id, seed);
    else if (url.pathname === "/api/family/cook-night/done" && req.method === "POST") r = await svc.cookNightDone(user.id, String(b.date || today));
    else {
      const id = context.params?.id;
      if (!id) return notFound();
      const sub = url.pathname.split(`/api/profiles/${id}/fun`)[1] || "";
      switch (`${req.method} ${sub}`) {
        case "GET /kids": r = await svc.kids(user.id, id, today, now); break;
        case "PUT /settings": r = await svc.setBuddy(user.id, id, b); break;
        case "POST /log": r = await svc.log(user.id, id, b as any); break;
        case "GET /quiz": r = await svc.quiz(user.id, id, seed); break;
        case "GET /hunt": r = await svc.hunt(user.id, id, dateParam(url, "from", today)); break;
        case "GET /wrapped": r = await svc.wrapped(user.id, id, today); break;
        case "GET /playlist": r = await svc.playlist(user.id, id, now); break;
        case "POST /spotify/start": r = await svc.spotifyStart(user.id, id); break;
        case "POST /spotify/build": r = await svc.buildSpotify(user.id, id, String(b.now || now)); break;
        case "DELETE /spotify": r = await svc.spotifyDisconnect(user.id, id); break;
        default: return json({ error: "method_not_allowed" }, 405);
      }
    }
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, status(r.code));
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/fun/kids", "/api/profiles/:id/fun/settings", "/api/profiles/:id/fun/log", "/api/profiles/:id/fun/quiz",
    "/api/profiles/:id/fun/hunt", "/api/profiles/:id/fun/wrapped", "/api/profiles/:id/fun/playlist",
    "/api/profiles/:id/fun/spotify", "/api/profiles/:id/fun/spotify/start", "/api/profiles/:id/fun/spotify/build",
    "/api/spotify/callback", "/api/family/cook-night", "/api/family/cook-night/done",
  ],
};
