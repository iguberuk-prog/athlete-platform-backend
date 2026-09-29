/**
 * Admin HTTP entry point (Netlify Functions v2).
 *
 * Routes:
 *   GET /api/admin/athletes   list every athlete profile across all owners
 *
 * Access is gated by a shared admin passcode: the caller must send
 * `x-admin-key` matching the ADMIN_KEY environment variable. This is a simple
 * stand-in for a full admin role and is intentionally separate from the
 * per-account login scoping used everywhere else.
 */

import type { Config, Context } from "@netlify/functions";
import { getProfileService } from "../../src/container.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    return json(
      { error: "admin_not_configured", message: "Set the ADMIN_KEY environment variable to enable admin access." },
      503,
    );
  }
  const provided = req.headers.get("x-admin-key");
  if (!provided || provided !== expected) {
    return json({ error: "unauthorized" }, 401);
  }
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const service = getProfileService();
    const athletes = await service.listAll();
    return json({ count: athletes.length, athletes });
  } catch (err) {
    const e = err as Error & { cause?: { message?: string } };
    const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
    return json({ error: "server_error", message: detail }, 500);
  }
};

export const config: Config = {
  path: ["/api/admin/athletes"],
};
