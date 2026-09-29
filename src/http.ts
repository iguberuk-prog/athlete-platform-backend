/**
 * Small helpers shared by the Netlify functions.
 */

import { verifyUser, type AuthUser } from "./auth.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const unauthorized = () => json({ error: "unauthorized", message: "Please sign in." }, 401);
export const notFound = (message = "Not found.") => json({ error: "not_found", message }, 404);

export function errorResponse(err: unknown): Response {
  const e = err as Error & { code?: string; cause?: { message?: string } };
  // Postgres "invalid input syntax" (e.g. a malformed uuid in the URL): treat as not found.
  if (e?.code === "22P02") return notFound();
  if (err instanceof SyntaxError) return json({ error: "bad_request", message: "Request body must be valid JSON." }, 400);
  console.error(err);
  return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
}

/** Returns the signed-in user, or null (caller responds 401). */
export async function currentUser(req: Request): Promise<AuthUser | null> {
  return verifyUser(req);
}

/** YYYY-MM-DD query param, or the given fallback. */
export function dateParam(url: URL, name: string, fallback: string): string {
  const v = url.searchParams.get(name);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

export function intParam(url: URL, name: string, fallback: number, lo: number, hi: number): number {
  const n = Number(url.searchParams.get(name));
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
}

/** Server-side "today" when the client sends none (UTC; clients should send their local date). */
export const utcToday = () => new Date().toISOString().slice(0, 10);
