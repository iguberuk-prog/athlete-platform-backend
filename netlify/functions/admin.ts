/**
 * Admin HTTP entry point (Netlify Functions v2) — platform operator tool.
 *
 *   GET /api/admin/athletes?limit=&offset=&full=   list athletes across all owners
 *
 * Access is gated by a shared admin passcode (`x-admin-key` === ADMIN_KEY),
 * compared in constant time. This is an operator/vendor tool — it is global and
 * NOT a per-club console (clubs use the role-scoped /api/clubs endpoints).
 *
 * By default it returns a trimmed summary per athlete (no health/contact PII)
 * and is paginated; pass `full=1` for complete profiles (operator deep-dives).
 */

import type { Config, Context } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getProfileService } from "../../src/container.js";
import type { AthleteProfile } from "../../src/domain/profile.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time passcode check (avoids leaking the key via response timing). */
function keyOk(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function summary(p: AthleteProfile) {
  return {
    id: p.id,
    ownerId: p.ownerId,
    name: p.identity?.fullName,
    sport: p.sport?.primarySport,
    positions: p.sport?.positions || [],
    competitionLevel: p.sport?.competitionLevel,
    playerCode: p.identity?.playerCode,
    createdAt: p.createdAt,
  };
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    return json(
      { error: "admin_not_configured", message: "Set the ADMIN_KEY environment variable to enable admin access." },
      503,
    );
  }
  if (!keyOk(req.headers.get("x-admin-key"), expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const full = url.searchParams.get("full") === "1";

    const all = await getProfileService().listAll();
    const page = all.slice(offset, offset + limit);
    return json({
      count: all.length,
      limit,
      offset,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      athletes: full ? page : page.map(summary),
    });
  } catch (err) {
    const e = err as Error & { cause?: { message?: string } };
    const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
    return json({ error: "server_error", message: detail }, 500);
  }
};

export const config: Config = {
  path: ["/api/admin/athletes"],
};
