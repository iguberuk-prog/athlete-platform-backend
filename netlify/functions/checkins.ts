/**
 * HTTP entry point for daily check-ins (Netlify Functions v2).
 *
 * Routes:
 *   POST   /api/profiles/:profileId/checkins        log (or overwrite) a check-in
 *   GET    /api/profiles/:profileId/checkins        list recent check-ins (?limit=N)
 *   DELETE /api/profiles/:profileId/checkins/:id    delete a check-in
 *
 * Owner identity comes from the verified Supabase login (Bearer token).
 */

import type { Config, Context } from "@netlify/functions";
import { verifyUser } from "../../src/auth.js";
import { errorResponse } from "../../src/http.js";
import { getCheckInService, getFamilyService } from "../../src/container.js";
import type { CheckInInput } from "../../src/domain/checkin.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}


export default async (req: Request, context: Context): Promise<Response> => {
  const userId = (await verifyUser(req))?.id ?? null;
  if (!userId) {
    return json(
      { error: "unauthorized", message: "Please sign in." },
      401,
    );
  }

  const service = await getCheckInService();
  const profileId = context.params?.profileId;
  const id = context.params?.id;
  if (!profileId) return json({ error: "profileId required in path" }, 400);
  // The owner, or a linked parent/player (family link). Unknown -> not found.
  const ownerId = (await getFamilyService().ownerFor(userId, profileId)) ?? "__none__";

  try {
    switch (req.method) {
      case "POST": {
        const body = (await req.json()) as Omit<CheckInInput, "profileId">;
        const input: CheckInInput = { ...body, profileId };
        const result = await service.log(ownerId, input);
        if (result.ok) return json(result.value, 201);
        return result.code === "validation"
          ? json({ error: "validation_failed", details: result.errors }, 422)
          : json({ error: "profile_not_found" }, 404);
      }

      case "GET": {
        const url = new URL(req.url);
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Number(limitParam) : undefined;
        const checkins = await service.list(ownerId, profileId, limit);
        return json({ checkins });
      }

      case "DELETE": {
        if (!id) return json({ error: "id required in path" }, 400);
        const result = await service.delete(ownerId, id);
        return result.ok
          ? new Response(null, { status: 204 })
          : json({ error: "not_found" }, 404);
      }

      default:
        return json({ error: "method_not_allowed" }, 405);
    }
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: [
    "/api/profiles/:profileId/checkins",
    "/api/profiles/:profileId/checkins/:id",
  ],
};
