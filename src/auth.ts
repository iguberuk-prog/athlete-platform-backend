/**
 * Authentication helper (Supabase Auth).
 *
 * Verifies the caller's Supabase access token (sent as `Authorization: Bearer
 * <jwt>`) and returns the authenticated account id. This is the single place
 * that turns a browser login into a trusted owner id — replacing the old
 * trusted owner id. Profiles and check-ins are scoped to this id everywhere.
 *
 * We validate the token by asking Supabase (`auth.getUser`) using a server-side
 * client, so no JWT secret needs to live in the app. Requires SUPABASE_URL and
 * SUPABASE_SERVICE_KEY (already set for the database layer).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

export type AccountRole = "athlete" | "parent" | "coach";

export interface AuthUser {
  id: string;
  email?: string;
  /** Chosen at sign-up; stored in Supabase user_metadata. */
  role: AccountRole;
}

const ROLES: AccountRole[] = ["athlete", "parent", "coach"];

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as never },
  });
  return client;
}

/** Extract a Bearer token from the Authorization header, or null. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Verify the request's access token and return the authenticated user, or null
 * when there is no valid token (caller should respond 401).
 */
export async function verifyUser(req: Request): Promise<AuthUser | null> {
  // Local development only: never active with the Supabase backend.
  if (process.env.ALLOW_DEV_AUTH === "1" && process.env.DB_BACKEND !== "supabase" && !process.env.NETLIFY) {
    const dev = req.headers.get("x-dev-user");
    if (dev) {
      const [email, role] = dev.split("|");
      const r = ROLES.includes(role as AccountRole) ? (role as AccountRole) : "athlete";
      return { id: "dev:" + email, email, role: r };
    }
  }
  const token = getBearerToken(req);
  if (!token) return null;
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const meta = (data.user.user_metadata || {}) as { role?: string };
  const role = ROLES.includes(meta.role as AccountRole) ? (meta.role as AccountRole) : "athlete";
  return { id: data.user.id, email: data.user.email ?? undefined, role };
}

/**
 * Permanently delete a login from Supabase Auth (account deletion).
 * Returns false when Supabase is not configured (local SQLite dev).
 */
export async function deleteAuthUser(id: string): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw error;
  return true;
}
