/**
 * HTTP entry point for athlete profiles (Netlify Functions v2 / Web API style).
 *
 * Routes (all under /api/profiles):
 *   POST   /api/profiles        create a profile
 *   GET    /api/profiles        list the caller's profiles
 *   GET    /api/profiles/:id    get one profile
 *   PUT    /api/profiles/:id    replace one profile
 *   DELETE /api/profiles/:id    delete one profile
 *
 * Owner identity comes from the `x-owner-id` header (stand-in for real auth).
 * This is the single seam where a verified token (e.g. a Supabase JWT subject)
 * will plug in later — the rest of the stack already scopes to this owner id.
 */

import type { Config, Context } from "@netlify/functions";
import { getProfileService } from "../../src/container.js";
import type { ProfileInput } from "../../src/domain/profile.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getOwnerId(req: Request): string | null {
  const id = req.headers.get("x-owner-id");
  return id && id.trim() ? id.trim() : null;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const ownerId = getOwnerId(req);
  if (!ownerId) {
    return json(
      { error: "missing x-owner-id header (stands in for authentication)" },
      401,
    );
  }

  const service = await getProfileService();
  const id = context.params?.id;

  try {
    switch (req.method) {
      case "POST": {
        const input = (await req.json()) as ProfileInput;
        const result = await service.create(ownerId, input);
        if (result.ok) return json(result.value, 201);
        return result.code === "validation"
          ? json({ error: "validation_failed", details: result.errors }, 422)
          : json({ error: "not_found" }, 404);
      }

      case "GET": {
        if (id) {
          const result = await service.get(ownerId, id);
          return result.ok ? json(result.value) : json({ error: "not_found" }, 404);
        }
        const profiles = await service.list(ownerId);
        return json({ profiles });
      }

      case "PUT": {
        if (!id) return json({ error: "id required in path" }, 400);
        const input = (await req.json()) as ProfileInput;
        const result = await service.update(ownerId, id, input);
        if (result.ok) return json(result.value);
        return result.code === "validation"
          ? json({ error: "validation_failed", details: result.errors }, 422)
          : json({ error: "not_found" }, 404);
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
    return json({ error: "bad_request", message: (err as Error).message }, 400);
  }
};

export const config: Config = {
  path: ["/api/profiles", "/api/profiles/:id"],
};
