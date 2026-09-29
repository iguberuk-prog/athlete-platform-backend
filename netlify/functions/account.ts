/**
 * Account endpoints:
 *
 *   GET    /api/account   who am I: { id, email, role }
 *   DELETE /api/account   permanently delete the account and all of its data
 *                         body: { confirm: "DELETE" }
 *
 * Deletion order: data first (profiles, check-ins, teams, memberships), then
 * the login itself in Supabase Auth, so a failure never leaves orphaned data
 * behind a deleted login.
 */

import type { Config } from "@netlify/functions";
import { deleteAuthUser } from "../../src/auth.js";
import { getAccountService } from "../../src/container.js";
import { currentUser, errorResponse, json, unauthorized } from "../../src/http.js";

export default async (req: Request): Promise<Response> => {
  const user = await currentUser(req);
  if (!user) return unauthorized();

  try {
    if (req.method === "GET") return json({ id: user.id, email: user.email, role: user.role });
    if (req.method === "DELETE") {
      const body = (await req.json().catch(() => ({}))) as { confirm?: string };
      if (body.confirm !== "DELETE") {
        return json({ error: "confirmation_required", message: 'Send { "confirm": "DELETE" } to delete the account.' }, 400);
      }
      const report = await getAccountService().deleteAllData(user.id);
      const loginDeleted = await deleteAuthUser(user.id);
      return json({ deleted: true, ...report, loginDeleted });
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: ["/api/account"] };
