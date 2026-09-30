/**
 *   GET /api/profiles/:id/meals ?from=YYYY-MM-DD   7-day meal plan + eating-out guide
 *   GET /api/profiles/:id/recipes                  every recipe that's safe for this player
 *   GET /api/profiles/:id/report ?date=            weekly parent report (screen)
 *   GET /api/profiles/:id/scan/:code ?now=&hot=1   barcode scan analysis
 */

import type { Config, Context } from "@netlify/functions";
import { getHealthService, getProductService, getReportService } from "../../src/container.js";
import { currentUser, dateParam, errorResponse, json, notFound, unauthorized, utcToday } from "../../src/http.js";
import { EQUIPMENT, type Equip, type RecipeFilter } from "../../src/domain/recipes.js";

/** ?have=microwave,oven (or none) &max=20 &meal=dinner &who=alone|together|parent &batch=1 */
function recipeFilter(url: URL): RecipeFilter {
  const f: RecipeFilter = {};
  const have = url.searchParams.get("have");
  if (have !== null) f.have = have === "none" ? [] : have.split(",").filter((x): x is Equip => (EQUIPMENT as readonly string[]).includes(x));
  const max = Number(url.searchParams.get("max"));
  if (max > 0) f.maxMinutes = Math.min(240, max);
  const meal = url.searchParams.get("meal");
  if (meal && ["breakfast", "lunch", "dinner", "snack", "recovery"].includes(meal)) f.meal = meal as RecipeFilter["meal"];
  const who = url.searchParams.get("who");
  if (who && ["alone", "together", "parent"].includes(who)) f.who = who as RecipeFilter["who"];
  if (url.searchParams.get("batch") === "1") f.batch = true;
  return f;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const id = context.params?.id;
  if (!id) return notFound();
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith("/meals")) {
      const f = recipeFilter(url);
      const r = await getHealthService().meals(user.id, id, dateParam(url, "from", utcToday()), { have: f.have, who: f.who });
      return r.ok ? json(r.value) : notFound("Profile not found.");
    }
    if (url.pathname.endsWith("/recipes")) {
      const r = await getHealthService().recipes(user.id, id, recipeFilter(url), utcToday());
      return r.ok ? json(r.value) : notFound("Profile not found.");
    }
    if (url.pathname.endsWith("/report")) {
      const r = await getReportService().weekly(user.id, id, dateParam(url, "date", utcToday()));
      return r.ok ? json(r.value) : notFound("Profile not found.");
    }
    const code = context.params?.code;
    if (code) {
      const r = await getProductService().scan(user.id, id, code, url.searchParams.get("now") || "", url.searchParams.get("hot") === "1");
      if (r.ok) return json(r.value);
      const status = r.code === "not_found" ? 404 : r.code === "unknown_product" ? 404 : r.code === "limit" ? 429 : r.code === "unavailable" ? 503 : 422;
      return json({ error: r.code, message: r.message }, status);
    }
    return notFound();
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles/:id/meals", "/api/profiles/:id/recipes", "/api/profiles/:id/report", "/api/profiles/:id/scan/:code"],
};
