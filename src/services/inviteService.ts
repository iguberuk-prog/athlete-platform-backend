/**
 * Invite a friend. Each account gets one short invite code and link.
 * The link opens a welcome page that shows how to get the app on a phone
 * (App Store / Google Play when listed, otherwise Add to Home Screen),
 * then sign-up. Friends who join with the code are counted for the inviter.
 *
 * Records (app_records):
 *   friendcode   id = CODE,            key = inviter user id
 *   friendjoin   id = new user id,     key = inviter user id   (one per new account)
 *   usage        id = invite:<user>:<day>                      (email limit)
 */

import { randomBytes } from "node:crypto";
import type { RecordRepository } from "../data/repository.js";
import type { Mailer } from "./notifier.js";

export type IResult<T> = { ok: true; value: T } | { ok: false; code: "invalid" | "limit" | "not_configured" | "not_found"; message?: string };

const appUrl = () => (process.env.APP_URL || process.env.URL || "http://localhost:8888").replace(/\/$/, "");
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(6), (b) => ALPHA[b % ALPHA.length]).join("");
const EMAIL = /^[^\s@<>(),;:"]{1,64}@[^\s@<>(),;:"]{1,255}\.[a-z]{2,}$/i;
const DAILY_EMAILS = 20;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cleanName = (s?: string) => String(s || "").replace(/[<>\r\n]/g, "").trim().slice(0, 40);

export function inviteLink(code: string, from?: string): string {
  const q = new URLSearchParams({ code });
  const n = cleanName(from).split(/\s+/)[0];
  if (n) q.set("from", n);
  return `${appUrl()}/#/invite?${q}`;
}

export function inviteText(from: string, link: string): string {
  const who = cleanName(from) || "A friend";
  return `${who} invited you to Athlete Performance: game-day fuel, recovery and sleep plans for soccer players, built around your age, allergies and schedule. Free for families. Get it here: ${link}`;
}

export class InviteService {
  constructor(private readonly records: RecordRepository, private readonly mailer: Mailer) {}

  private async codeFor(userId: string): Promise<string> {
    const mine = await this.records.listByKey<{ userId: string }>("friendcode", userId);
    if (mine[0]) return mine[0].id;
    let code = newCode();
    for (let i = 0; i < 5 && (await this.records.get("friendcode", code)); i++) code = newCode();
    await this.records.put({ id: code, kind: "friendcode", key: userId, ownerId: userId, data: { userId } });
    return code;
  }

  /** Code, link, ready-made message, store links and how many friends joined. */
  async mine(userId: string, from?: string) {
    const code = await this.codeFor(userId);
    const link = inviteLink(code, from);
    const joined = (await this.records.listByKey("friendjoin", userId)).length;
    return {
      code, link, text: inviteText(from || "", link), joined,
      stores: { ios: process.env.APP_STORE_URL || null, android: process.env.PLAY_STORE_URL || null },
      emailReady: !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
    };
  }

  /** Email the invite (up to 10 addresses a send, 20 a day). */
  async email(userId: string, fromEmail: string | undefined, b: { to?: unknown; from?: string; note?: string }, today: string): Promise<IResult<{ sent: number; skipped: string[] }>> {
    const list = (Array.isArray(b.to) ? b.to : String(b.to || "").split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const uniq = [...new Set(list)];
    if (!uniq.length) return { ok: false, code: "invalid", message: "Add at least one email address." };
    if (uniq.length > 10) return { ok: false, code: "invalid", message: "Up to 10 addresses at a time." };
    const bad = uniq.filter((e) => !EMAIL.test(e));
    if (bad.length) return { ok: false, code: "invalid", message: `Check ${bad.slice(0, 3).join(", ")}.` };
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { ok: false, code: "not_configured", message: "Email sending isn't set up yet. Use Share or Text instead." };
    const usageId = `invite:${userId}:${today}`;
    const used = (await this.records.get<{ n: number }>("usage", usageId))?.data.n ?? 0;
    if (used + uniq.length > DAILY_EMAILS) return { ok: false, code: "limit", message: `You can email ${Math.max(0, DAILY_EMAILS - used)} more invites today.` };
    const skipped = fromEmail ? uniq.filter((e) => e === fromEmail.toLowerCase()) : [];
    const to = uniq.filter((e) => !skipped.includes(e));
    if (!to.length) return { ok: false, code: "invalid", message: "That's your own address." };

    const from = cleanName(b.from) || "A friend";
    const note = String(b.note || "").replace(/[<>]/g, "").trim().slice(0, 300);
    const code = await this.codeFor(userId);
    const link = inviteLink(code, from);
    const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#111">
      <h2 style="margin:0 0 8px">${esc(from)} invited you to Athlete Performance</h2>
      <p>Game-day fuel, recovery and sleep plans for soccer players. Built around each player's age, allergies and team schedule. Free for families.</p>
      ${note ? `<p style="background:#f4f6f8;border-radius:10px;padding:12px">"${esc(note)}"<br>- ${esc(from)}</p>` : ""}
      <p style="margin:22px 0"><a href="${esc(link)}" style="background:#bff63f;color:#0b0e12;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:800">Get the app</a></p>
      <p style="font-size:13px;color:#555">Open this email on your phone and tap the button. Invite code: <b>${code}</b></p>
      <p style="font-size:12px;color:#888">You got this because ${esc(from)} entered your email. We don't keep your address or add you to any list.</p></div>`;
    const res = await this.mailer.send({ to, subject: `${from} invited you to Athlete Performance`, html, text: `${inviteText(from, link)}${note ? `\n\n"${note}"` : ""}` });
    if (!res.sent) return { ok: false, code: "not_configured", message: "The email didn't send. Use Share or Text instead." };
    await this.records.put({ id: usageId, kind: "usage", key: today, ownerId: userId, data: { n: used + to.length } });
    return { ok: true, value: { sent: to.length, skipped } };
  }

  /** A new account that arrived through an invite link. Counted once, never for yourself. */
  async redeem(newUserId: string, code: string): Promise<IResult<{ counted: boolean }>> {
    const c = await this.records.get<{ userId: string }>("friendcode", String(code || "").toUpperCase().slice(0, 12));
    if (!c) return { ok: false, code: "not_found", message: "That invite code wasn't found." };
    if (c.key === newUserId) return { ok: true, value: { counted: false } };
    if (await this.records.get("friendjoin", newUserId)) return { ok: true, value: { counted: false } };
    await this.records.put({ id: newUserId, kind: "friendjoin", key: c.key, ownerId: c.key, data: { at: new Date().toISOString() } });
    return { ok: true, value: { counted: true } };
  }

  /** Public: who invited (first name only is in the link), and where to download. */
  async lookup(code: string) {
    const c = await this.records.get("friendcode", String(code || "").toUpperCase().slice(0, 12)).catch(() => null);
    return { valid: !!c, stores: { ios: process.env.APP_STORE_URL || null, android: process.env.PLAY_STORE_URL || null } };
  }
}
