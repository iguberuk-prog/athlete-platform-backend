/**
 * Team calendar subscriptions:
 *
 *   POST   /api/profiles/:id/calendars { url, name?, defaultZip? }   add + first sync
 *   POST   /api/profiles/:id/calendars/sync                        re-sync all feeds now
 *   DELETE /api/profiles/:id/calendars/:feedId                     remove feed and its events
 */

import type { Config, Context } from "@netlify/functions";
import { getCalendarService } from "../../src/container.js";
import { currentUser, errorResponse, json, notFound, unauthorized } from "../../src/http.js";

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const id = context.params?.id;
  if (!id) return notFound();
  const svc = getCalendarService();
  const url = new URL(req.url);
  try {
    let r;
    if (req.method === "POST" && url.pathname.endsWith("/sync")) r = await svc.syncAll(user.id, id);
    else if (req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { url?: string; name?: string; defaultZip?: string };
      r = await svc.add(user.id, id, String(b.url || ""), b.name, b.defaultZip || undefined);
    } else if (req.method === "DELETE" && context.params?.feedId) r = await svc.remove(user.id, id, context.params.feedId);
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value) : json({ error: r.code, message: r.message }, r.code === "not_found" ? 404 : 422);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/calendars", "/api/profiles/:id/calendars/sync", "/api/profiles/:id/calendars/:feedId"],
};
