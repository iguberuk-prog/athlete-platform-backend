/**
 * Public client config (Netlify Functions v2).
 *
 * Returns the values the browser needs to initialize Supabase Auth: the project
 * URL and the *anon* (public) key. The anon key is designed to be exposed in the
 * browser — it is NOT the service key. Serving it from here keeps it out of the
 * static HTML and lets it come from environment variables.
 *
 *   GET /api/config  ->  { supabaseUrl, supabaseAnonKey }
 */

import type { Config } from "@netlify/functions";

export default async (): Promise<Response> => {
  const body = {
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
    // Local development login (never on with the Supabase backend).
    devAuth: process.env.ALLOW_DEV_AUTH === "1" && process.env.DB_BACKEND !== "supabase" && !process.env.NETLIFY,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};

export const config: Config = {
  path: ["/api/config"],
};
