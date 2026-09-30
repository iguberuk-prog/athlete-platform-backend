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
import { getProfileService, getFamilyService } from "../../src/container.js";
import { effectiveAge, type AthleteProfile, type ProfileInput } from "../../src/domain/profile.js";
import { featuresFor } from "../../src/domain/features.js";

/** Drop display-only fields the app may send back. */
function clean(input: ProfileInput): ProfileInput {
  const x = { ...(input as unknown as Record<string, unknown>) };
  for (const k of ["features", "featuresOff", "shared", "linkRole", "id", "ownerId", "createdAt", "updatedAt"]) delete x[k];
  return x as unknown as ProfileInput;
}

/** Attach the age-based feature switches so the app shows the right screens. */
const withFeatures = <T extends AthleteProfile>(p: T) => { const f = featuresFor(p); return { ...p, features: f.on, featuresOff: f.off }; };

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
        const input = clean((await req.json()) as ProfileInput);
        const young = under13(user?.role, input);
        if (young) return young;
        const result = await service.create(ownerId, input);
        if (result.ok) return json(withFeatures(result.value), 201);
        return result.code === "validation"
          ? json({ error: "validation_failed", details: result.errors }, 422)
          : json({ error: "not_found" }, 404);
      }

      case "GET": {
        if (id) {
          const owner = (await getFamilyService().ownerFor(ownerId, id)) ?? "__none__";
          const result = await service.get(owner, id);
          return result.ok ? json({ ...withFeatures(result.value), shared: owner !== ownerId }) : json({ error: "not_found" }, 404);
        }
        const own = await service.list(ownerId);
        // Profiles shared with this account through a family link.
        const linked = (await getFamilyService().linkedProfiles(ownerId)).map((p) => ({ ...p, shared: true }));
        return json({ profiles: [...own, ...linked].map(withFeatures) });
      }

      case "PUT": {
        if (!id) return json({ error: "id required in path" }, 400);
        const input = clean((await req.json()) as ProfileInput);
        const young = under13(user?.role, input);
        if (young) return young;
        const result = await service.update(ownerId, id, input);
        if (result.ok) return json(withFeatures(result.value));
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
