/**
 * Club subscriptions through Stripe (clubs pay per player; families use the
 * app free). A club paying for a team service on the web is outside Apple's
 * in-app purchase rules; the iPhone app never shows prices or a buy button.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (a recurring per-seat price),
 *      STRIPE_WEBHOOK_SECRET, APP_URL.
 * Webhook URL to add in Stripe: {APP_URL}/api/stripe/webhook
 * Events: checkout.session.completed, customer.subscription.updated,
 *         customer.subscription.deleted, invoice.payment_failed
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { RecordRepository } from "../data/repository.js";
import type { Club } from "../domain/club.js";
import type { ClubService } from "./clubService.js";

export type BResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "forbidden" | "invalid" | "not_configured" | "failed"; message?: string };

const appUrl = () => (process.env.APP_URL || process.env.URL || "http://localhost:8888").replace(/\/$/, "");

function form(obj: Record<string, string | number | undefined>): string {
  return Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((x) => x.length === 2));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export class BillingService {
  constructor(private readonly clubs: ClubService, private readonly records: RecordRepository, private readonly http: typeof fetch = fetch) {}

  private async stripe(path: string, body: Record<string, string | number | undefined>): Promise<any> {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("not_configured");
    const res = await this.http(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });
    const j: any = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Stripe ${res.status}`);
    return j;
  }

  async checkout(userId: string, clubId: string, seats: number): Promise<BResult<{ url: string }>> {
    const club = await this.clubs.club(clubId);
    if (!club) return { ok: false, code: "not_found" };
    if (club.directorId !== userId && (await this.clubs.staff(clubId, userId))?.role !== "director") return { ok: false, code: "forbidden" };
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return { ok: false, code: "not_configured", message: "Billing isn't set up on the server yet." };
    if (!(Number.isInteger(seats) && seats >= 1 && seats <= 5000)) return { ok: false, code: "invalid", message: "Enter the number of players (1 to 5,000)." };
    const trialDays = (club.freeMonths || 0) * 30 || undefined;
    try {
      const s = await this.stripe("checkout/sessions", {
        mode: "subscription",
        "line_items[0][price]": process.env.STRIPE_PRICE_ID,
        "line_items[0][quantity]": seats,
        client_reference_id: club.id,
        "metadata[clubId]": club.id,
        "subscription_data[metadata][clubId]": club.id,
        "subscription_data[trial_period_days]": trialDays,
        customer: club.stripeCustomerId,
        success_url: `${appUrl()}/#/club/${club.id}?billing=ok`,
        cancel_url: `${appUrl()}/#/club/${club.id}?billing=cancel`,
        allow_promotion_codes: "true",
      });
      return { ok: true, value: { url: s.url } };
    } catch (err) {
      return { ok: false, code: "failed", message: (err as Error).message };
    }
  }

  async portal(userId: string, clubId: string): Promise<BResult<{ url: string }>> {
    const club = await this.clubs.club(clubId);
    if (!club) return { ok: false, code: "not_found" };
    if ((await this.clubs.staff(clubId, userId))?.role !== "director") return { ok: false, code: "forbidden" };
    if (!club.stripeCustomerId) return { ok: false, code: "invalid", message: "No subscription yet." };
    try {
      const s = await this.stripe("billing_portal/sessions", { customer: club.stripeCustomerId, return_url: `${appUrl()}/#/club/${club.id}` });
      return { ok: true, value: { url: s.url } };
    } catch (err) {
      return { ok: false, code: "failed", message: (err as Error).message };
    }
  }

  /** Apply a verified Stripe event. Idempotent per event id. */
  async handleEvent(ev: any): Promise<string> {
    if (!ev?.id || !ev?.type) return "ignored";
    if (await this.records.get("stripe_event", ev.id)) return "duplicate";
    const o = ev.data?.object || {};
    const clubId = o.metadata?.clubId || o.client_reference_id || o.subscription_details?.metadata?.clubId;
    const club = clubId ? await this.clubs.club(clubId) : null;
    let result = "ignored";
    if (club) {
      const next: Club = { ...club };
      switch (ev.type) {
        case "checkout.session.completed":
          next.stripeCustomerId = o.customer || next.stripeCustomerId;
          next.stripeSubscriptionId = o.subscription || next.stripeSubscriptionId;
          next.plan = "active"; next.freeMonths = 0; result = "activated"; break;
        case "customer.subscription.updated":
          next.plan = o.status === "active" || o.status === "trialing" ? "active" : o.status === "past_due" || o.status === "unpaid" ? "past_due" : o.status === "canceled" ? "canceled" : next.plan;
          next.seats = o.items?.data?.[0]?.quantity ?? next.seats; result = `status:${next.plan}`; break;
        case "customer.subscription.deleted":
          next.plan = "canceled"; result = "canceled"; break;
        case "invoice.payment_failed":
          next.plan = "past_due"; result = "past_due"; break;
      }
      await this.clubs.saveClub(next);
    }
    await this.records.put({ id: ev.id, kind: "stripe_event", key: ev.type, ownerId: "stripe", data: { result } });
    return result;
  }
}
