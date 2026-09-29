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
 * Owner identity comes from the verified Supabase login (Bearer token).
 * See src/auth.ts. Every query below is scoped to that account id.
 */

import type { Config, Context } from "@netlify/functions";
import { verifyUser } from "../../src/auth.js";
import { errorResponse } from "../../src/http.js";
import { getProfileService } from "../../src/container.js";
import { effectiveAge, type ProfileInput } from "../../src/domain/profile.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}


/**
 * Children under 13 need a parent account (COPPA / App Store kids rules).
 * An athlete's own account cannot hold an under-13 profile.
 */
function under13(role: string | undefined, input: ProfileInput): Response | null {
  if (role === "parent") return null;
  const age = input?.identity ? effectiveAge(input.identity) : undefined;
  if (age !== undefined && age < 13) {
    return json(
      {
        error: "parent_required",
        message: "Players under 13 need a parent or guardian to set up the account. Ask a parent to sign up with a parent account.",
      },
      403,
    );
  }
  return null;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await verifyUser(req);
  const ownerId = user?.id ?? null;
  if (!ownerId) {
    return json(
      { error: "unauthorized", message: "Please sign in." },
      401,
    );
  }

  const service = await getProfileService();
  const id = context.params?.id;

  try {
    switch (req.method) {
      case "POST": {
        const input = (await req.json()) as ProfileInput;
        const young = under13(user?.role, input);
        if (young) return young;
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
        const young = under13(user?.role, input);
        if (young) return young;
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
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/profiles", "/api/profiles/:id"],
};
