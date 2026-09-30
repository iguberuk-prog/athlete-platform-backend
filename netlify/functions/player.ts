/**
 * Player extras (owner or linked family):
 *
 *   GET    /api/profiles/:id/journal                 logs, season stats, "what worked"
 *   POST   /api/profiles/:id/journal                 add a post-game reflection / stats
 *   DELETE /api/profiles/:id/journal/:logId
 *   GET    /api/profiles/:id/progress                streaks and badges
 *   GET    /api/profiles/:id/risk                    early warning score
 *   GET    /api/profiles/:id/extras                  mental skills, position fuel, tournaments, emergency card, SafeSport
 *   GET    /api/profiles/:id/season                  season review data
 *   GET    /api/profiles/:id/next ?now=              countdown to the next game or practice
 *   GET    /api/profiles/:id/budget
 *   POST   /api/profiles/:id/budget/expenses
 *   DELETE /api/profiles/:id/budget/expenses/:exId
 *   PUT    /api/profiles/:id/budget/plan { amount }
 *   POST   /api/profiles/:id/ask { question, history?, now? }
 */

import type { Config, Context } from "@netlify/functions";
import { getAskService, getFamilyService, getPlayerService, getProfileService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";
import { nextUp } from "../../src/domain/dayplans.js";

const fail = (r: { code: string; message?: string }) =>
  json({ error: r.code, message: r.message }, r.code === "not_found" ? 404 : r.code === "limit" ? 429 : r.code === "not_configured" ? 501 : r.code === "failed" ? 502 : 422);

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  const id = context.params?.id;
  if (!id) return notFound();
  const url = new URL(req.url);
  const path = url.pathname.split(`/api/profiles/${id}`)[1] || "";
  const svc = getPlayerService();
  const today = dateParam(url, "date", utcToday());
  const or404 = (v: unknown) => (v ? json(v) : notFound("Profile not found."));
  try {
    if (req.method === "GET") {
      if (path === "/journal") return or404(await svc.journal(user.id, id, today));
      if (path === "/progress") return or404(await svc.progress(user.id, id, today));
      if (path === "/risk") return or404(await svc.risk(user.id, id, today));
      if (path === "/extras") return or404(await svc.extras(user.id, id, today));
      if (path === "/season") return or404(await svc.seasonReview(user.id, id, today));
      if (path === "/budget") return or404(await svc.budget(user.id, id, today));
      if (path === "/next") {
        const owner = await getFamilyService().ownerFor(user.id, id);
        const p = owner ? await getProfileService().get(owner, id) : null;
        if (!p || !p.ok) return notFound();
        const now = url.searchParams.get("now") || new Date().toISOString().slice(0, 16);
        return json({ next: nextUp(p.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(now) ? now.slice(0, 16) : new Date().toISOString().slice(0, 16)) });
      }
      return notFound();
    }
    const b = req.method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>);
    let r;
    if (req.method === "POST" && path === "/journal") r = await svc.addLog(user.id, id, b as any);
    else if (req.method === "DELETE" && path.startsWith("/journal/")) r = await svc.deleteLog(user.id, id, context.params?.logId || "");
    else if (req.method === "POST" && path === "/budget/expenses") r = await svc.addExpense(user.id, id, b as any);
    else if (req.method === "DELETE" && path.startsWith("/budget/expenses/")) r = await svc.deleteExpense(user.id, id, context.params?.exId || "");
    else if (req.method === "PUT" && path === "/budget/plan") r = await svc.setBudgetPlan(user.id, id, b.amount === null ? null : Number(b.amount));
    else if (req.method === "POST" && path === "/ask") r = await getAskService().ask(user.id, id, String(b.question || ""), Array.isArray(b.history) ? b.history : [], today, String(b.now || new Date().toISOString().slice(0, 16)));
    else return json({ error: "method_not_allowed" }, 405);
    return r.ok ? json(r.value, req.method === "POST" && path !== "/ask" ? 201 : 200) : fail(r);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:id/journal", "/api/profiles/:id/journal/:logId",
    "/api/profiles/:id/progress", "/api/profiles/:id/risk", "/api/profiles/:id/extras", "/api/profiles/:id/season", "/api/profiles/:id/next",
    "/api/profiles/:id/budget", "/api/profiles/:id/budget/expenses", "/api/profiles/:id/budget/expenses/:exId", "/api/profiles/:id/budget/plan",
    "/api/profiles/:id/ask",
  ],
};
