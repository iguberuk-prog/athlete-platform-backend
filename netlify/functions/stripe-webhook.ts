/** POST /api/stripe/webhook  (Stripe calls this; verified with STRIPE_WEBHOOK_SECRET) */

import type { Config } from "@netlify/functions";
import { getBillingService } from "../../src/container.js";
import { verifyStripeSignature } from "../../src/services/billingService.js";
import { json } from "../../src/http.js";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "not_configured" }, 501);
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) return json({ error: "bad_signature" }, 400);
  try {
    const result = await getBillingService().handleEvent(JSON.parse(raw));
    return json({ received: true, result });
  } catch (err) {
    console.error("stripe webhook", err);
    return json({ error: "server_error" }, 500);
  }
};

export const config: Config = { path: "/api/stripe/webhook" };
