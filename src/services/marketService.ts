/**
 * Marketplace: registered dietitians (one-on-one video consults) and camps
 * and clinics matched to age, position and distance.
 *
 * Dietitians apply in the app and appear only after an admin approves them
 * (credentials checked by a person). Families send a booking request; the
 * dietitian gets it by email and books and bills through their own link
 * (Calendly, Healthie, etc.). A platform fee needs Stripe Connect and is
 * the next step once dietitians sign on.
 *
 * Camps: club directors post for their players; admins can post public ones.
 */

import { randomUUID } from "node:crypto";
import type { AthleteProfileRepository, RecordRepository } from "../data/repository.js";
import { matchCamps, type Camp } from "../domain/club.js";
import { zipToLatLon } from "../weather/nws.js";
import type { FamilyService } from "./familyService.js";
import type { ClubService } from "./clubService.js";
import { clubActive } from "./clubService.js";
import type { Mailer } from "./notifier.js";
import { escHtml } from "./notifier.js";

export type MResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "forbidden" | "invalid" | "inactive"; message?: string };

export interface Dietitian {
  id: string;
  userId: string;
  name: string;
  credentials: string;
  licenseState?: string;
  email: string;
  bio?: string;
  specialties: string[];
  states: string[];
  ageGroups: string[];
  rate?: number;
  bookingUrl?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const https = (u: unknown) => (typeof u === "string" && /^https:\/\/\S{4,400}$/.test(u) ? u : undefined);

export class MarketService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly clubs: ClubService,
    private readonly mailer: Mailer,
  ) {}

  // --- dietitians -----------------------------------------------------------------

  async apply(userId: string, email: string | undefined, b: Partial<Dietitian>): Promise<MResult<Dietitian>> {
    const name = clean(b.name, 80), cred = clean(b.credentials, 40);
    if (!name || !/\bRDN?\b|\bRD\b|CSSD/i.test(cred)) return { ok: false, code: "invalid", message: "Listing is for registered dietitians: add your name and credentials (RD or RDN; CSSD welcome)." };
    const mail = clean(b.email || email, 120);
    if (!/^\S+@\S+\.\S+$/.test(mail)) return { ok: false, code: "invalid", message: "Add a contact email." };
    const prev = (await this.records.listByOwner<Dietitian>("dietitian", userId))[0];
    const d: Dietitian = {
      id: prev?.id || randomUUID(), userId, name, credentials: cred, licenseState: clean(b.licenseState, 2).toUpperCase() || undefined, email: mail,
      bio: clean(b.bio, 600) || undefined,
      specialties: (Array.isArray(b.specialties) ? b.specialties : []).map((s) => clean(s, 40)).filter(Boolean).slice(0, 8),
      states: (Array.isArray(b.states) ? b.states : []).map((s) => clean(s, 2).toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).slice(0, 55),
      ageGroups: (Array.isArray(b.ageGroups) ? b.ageGroups : []).map((s) => clean(s, 20)).filter(Boolean).slice(0, 8),
      rate: typeof b.rate === "number" && b.rate > 0 && b.rate < 2000 ? Math.round(b.rate) : undefined,
      bookingUrl: https(b.bookingUrl),
      status: "pending", createdAt: prev?.data.createdAt || new Date().toISOString(),
    };
    await this.records.put({ id: d.id, kind: "dietitian", key: "dietitian", ownerId: userId, data: d });
    return { ok: true, value: d };
  }

  async list(state?: string): Promise<Omit<Dietitian, "email" | "userId">[]> {
    return (await this.records.listByKey<Dietitian>("dietitian", "dietitian"))
      .map((r) => r.data)
      .filter((d) => d.status === "approved" && (!state || !d.states.length || d.states.includes(state.toUpperCase())))
      .map(({ email: _e, userId: _u, ...rest }) => rest);
  }

  async review(id: string, status: "approved" | "rejected"): Promise<MResult<Dietitian>> {
    const r = await this.records.get<Dietitian>("dietitian", id);
    if (!r) return { ok: false, code: "not_found" };
    const d = { ...r.data, status };
    await this.records.put({ id, kind: "dietitian", key: "dietitian", ownerId: r.ownerId, data: d });
    return { ok: true, value: d };
  }

  async pending(): Promise<Dietitian[]> {
    return (await this.records.listByKey<Dietitian>("dietitian", "dietitian")).map((r) => r.data).filter((d) => d.status === "pending");
  }

  /** A family asks a dietitian for a consult. Only the parent's contact and the player's age and goals are shared. */
  async requestBooking(userId: string, email: string | undefined, b: { dietitianId: string; profileId: string; message?: string; times?: string }): Promise<MResult<{ sent: boolean; bookingUrl?: string }>> {
    const d = await this.records.get<Dietitian>("dietitian", b.dietitianId);
    if (!d || d.data.status !== "approved") return { ok: false, code: "not_found" };
    const owner = await this.family.ownerFor(userId, b.profileId);
    const p = owner ? await this.profiles.getById(owner, b.profileId) : null;
    if (!p) return { ok: false, code: "not_found" };
    const day = new Date().toISOString().slice(0, 10);
    const n = (await this.records.listByOwner<{ date: string }>("booking", userId)).filter((x) => x.data.date === day).length;
    if (n >= 5) return { ok: false, code: "invalid", message: "5 requests a day. Try again tomorrow." };
    const first = p.identity.fullName.split(" ")[0];
    const age = p.identity.dateOfBirth ? Math.floor((Date.now() - Date.parse(p.identity.dateOfBirth)) / 3.15576e10) : p.identity.age;
    const text = [
      `New consult request from Athlete Performance.`,
      `Player: ${first}, age ${age ?? "not given"}, soccer (${(p.sport.positions || []).join(", ") || "position not given"}).`,
      `Contact: ${email || "no email on file"}.`,
      b.times ? `Good times: ${clean(b.times, 200)}` : "",
      b.message ? `Message: ${clean(b.message, 800)}` : "",
      "Reply to the family directly to book. Allergy and medical details are shared by the family during the consult, not by the app.",
    ].filter(Boolean).join("\n\n");
    const res = await this.mailer.send({ to: [d.data.email], subject: `Consult request for ${first}`, text, html: text.split("\n\n").map((t) => `<p>${escHtml(t)}</p>`).join("") });
    await this.records.put({ id: randomUUID(), kind: "booking", key: d.id, ownerId: userId, data: { date: day, profileId: p.id, sent: res.sent } });
    return { ok: true, value: { sent: res.sent, bookingUrl: d.data.bookingUrl } };
  }

  // --- camps -------------------------------------------------------------------------

  async addCamp(userId: string, b: Partial<Camp> & { clubId?: string }, admin = false): Promise<MResult<Camp>> {
    if (!admin) {
      if (!b.clubId) return { ok: false, code: "invalid", message: "Pick your club." };
      const club = await this.clubs.club(b.clubId);
      if (!club) return { ok: false, code: "not_found" };
      if ((await this.clubs.staff(club.id, userId))?.role !== "director") return { ok: false, code: "forbidden" };
      if (!clubActive(club)) return { ok: false, code: "inactive", message: "Posting camps needs an active club plan." };
    }
    const title = clean(b.title, 80), org = clean(b.org, 80), zip = clean(b.zip, 5);
    if (!title || !org || !/^\d{5}$/.test(zip) || !isDay(b.start) || (b.end && !isDay(b.end))) return { ok: false, code: "invalid", message: "Camps need a title, organizer, ZIP and start date." };
    const ageMin = Number(b.ageMin), ageMax = Number(b.ageMax);
    if (!(ageMin >= 4 && ageMax <= 30 && ageMin <= ageMax)) return { ok: false, code: "invalid", message: "Ages must be between 4 and 30." };
    const camp: Camp = {
      id: randomUUID(), clubId: admin ? undefined : b.clubId, title, org, url: https(b.url), start: b.start!, end: b.end, zip, ageMin, ageMax,
      positions: (Array.isArray(b.positions) ? b.positions : []).filter((x) => ["goalkeeper", "defender", "fullback", "midfielder", "winger", "forward"].includes(x)),
      price: typeof b.price === "number" && b.price >= 0 && b.price < 20000 ? Math.round(b.price) : undefined, description: clean(b.description, 500) || undefined,
    };
    await this.records.put({ id: camp.id, kind: "camp", key: camp.clubId || "public", ownerId: userId, data: camp });
    return { ok: true, value: camp };
  }

  async removeCamp(userId: string, id: string, admin = false): Promise<MResult<true>> {
    const r = await this.records.get<Camp>("camp", id);
    if (!r) return { ok: false, code: "not_found" };
    if (!admin && r.ownerId !== userId) return { ok: false, code: "forbidden" };
    await this.records.delete("camp", id);
    return { ok: true, value: true };
  }

  /** Camps for a player: public ones plus their clubs', matched to age, position and distance. */
  async campsFor(userId: string, profileId: string, today: string, clubIds: string[]) {
    const owner = await this.family.ownerFor(userId, profileId);
    const p = owner ? await this.profiles.getById(owner, profileId) : null;
    if (!p) return null;
    const lists = await Promise.all(["public", ...clubIds].map((k) => this.records.listByKey<Camp>("camp", k)));
    return matchCamps(p, lists.flat().map((r) => r.data), today, zipToLatLon, 75);
  }
}
