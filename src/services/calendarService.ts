/**
 * Team calendar subscriptions (TeamSnap, SportsEngine, PlayMetrics, ...).
 *
 * The app stores the feed link on the profile, fetches it on demand and once a
 * day (scheduled function), and replaces that feed's events. Manual events and
 * other feeds are never touched. A player on two teams adds two feeds, and the
 * overuse guard sees both schedules together.
 */

import { randomUUID } from "node:crypto";
import type { AthleteProfileRepository } from "../data/repository.js";
import type { AthleteProfile, CalendarFeed, ProfileInput, ScheduledEvent } from "../domain/profile.js";
import { detectApp } from "../domain/teamApps.js";
import { parseIcs, toScheduled } from "../domain/ics.js";
import { isFeedUrl } from "../domain/validation.js";
import type { FamilyService } from "./familyService.js";

const MAX_BYTES = 2_000_000;

/** A calendar feed link inside a web page (webcal://, .ics, or an "ical" link), made absolute. */
export function feedLinkIn(html: string, base: string): string | null {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  const pick = hrefs.find((h) => /^webcal:/i.test(h)) || hrefs.find((h) => /\.ics(\?|$)/i.test(h)) || hrefs.find((h) => /ical|icalendar|calendar\/feed|ics_feed/i.test(h) && !/instructions|help/i.test(h));
  if (!pick) return null;
  try { return new URL(pick.replace(/^webcal:/i, "https:"), base).toString(); } catch { return null; }
}

/**
 * Clean up whatever a parent pasted: spaces, quotes, extra words around the link,
 * webcal:// or http:// (both become https://). Returns null when there's no link in it.
 */
export function normalizeFeedUrl(raw: string): string | null {
  const text = String(raw || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const m = text.match(/(webcals?|https?):\/\/[^\s"'<>]+/i) || text.match(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s"'<>]*/i);
  if (!m) return null;
  let u = m[0].replace(/[),.;]+$/, "");
  if (!/^[a-z]+:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/^webcals?:\/\//i, "https://").replace(/^http:\/\//i, "https://");
  return isFeedUrl(u) ? u : null;
}

async function get(url: string, signal: AbortSignal) {
  const init = { signal, headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "AthletePerformance/1.0 calendar-sync" } };
  try {
    return await fetch(url, init);
  } catch (e) {
    // A few calendar servers still only answer on plain http.
    if (signal.aborted) throw e;
    return fetch(url.replace(/^https:/i, "http:"), init);
  }
}

export async function fetchFeed(url: string, depth = 0): Promise<string> {
  const https = normalizeFeedUrl(url) || url;
  if (!isFeedUrl(https)) throw new Error("That doesn't look like a calendar link.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await get(https, ctl.signal);
    if (!isFeedUrl((res.url || https).replace(/^http:/i, "https:"))) throw new Error("The calendar link redirected somewhere we can't use.");
    if (!res.ok) throw new Error(`The calendar site answered ${res.status}. Check the link.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("That calendar is too large.");
    if (!/BEGIN:VCALENDAR/.test(text)) {
      // People often paste the schedule page instead of its feed. Look for the feed link on that page once.
      const inner = depth === 0 && /<html|<a\s/i.test(text) ? feedLinkIn(text, res.url || https) : null;
      if (inner) return fetchFeed(inner, 1);
      throw new Error("That link isn't a calendar feed. Look for 'Subscribe', 'Sync calendar' or 'iCal' in your team app and copy that link.");
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

const strip = (p: AthleteProfile): ProfileInput => {
  const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
};

/** Reads events for a signed-in feed (TeamSnap team, Google calendar). Throws with a readable message. */
export type ProviderReader = (p: AthleteProfile, feed: CalendarFeed, fromMs: number, toMs: number) => Promise<ScheduledEvent[]>;

export type CalResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid"; message?: string };

export class CalendarService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly fetcher: (url: string) => Promise<string> = fetchFeed,
    private reader?: ProviderReader,
  ) {}

  setReader(r: ProviderReader) { this.reader = r; }

  private async load(userId: string, id: string) {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }

  async add(userId: string, id: string, rawUrl: string, name?: string, defaultZip?: string): Promise<CalResult<AthleteProfile>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const url = normalizeFeedUrl(rawUrl);
    if (!url) return { ok: false, code: "invalid", message: "That doesn't contain a web link. Copy the whole calendar link (it starts with webcal://, https:// or http://)." };
    if (defaultZip && !/^\d{5}$/.test(defaultZip)) return { ok: false, code: "invalid", message: "ZIP must be 5 digits." };
    const feeds = r.p.schedule?.feeds || [];
    if (feeds.length >= 6) return { ok: false, code: "invalid", message: "Up to 6 team calendars per player." };
    if (feeds.some((f) => f.url === url)) return { ok: false, code: "invalid", message: "That calendar is already added." };
    const app = detectApp(url);
    const feed: CalendarFeed = { id: randomUUID(), url, kind: "ics", app: app?.id, name: String(name || (app && app.id !== "ical" ? (app.id === "google" ? "Google calendar" : `${app.name} calendar`) : "Team calendar")).slice(0, 60), defaultZip: defaultZip || undefined };
    const synced = await this.syncOne({ ...r.p, schedule: { ...(r.p.schedule || { events: [] }), feeds: [...feeds, feed] } }, feed.id);
    const added = synced.schedule?.feeds?.find((f) => f.id === feed.id);
    if (added?.lastError) return { ok: false, code: "invalid", message: added.lastError };
    const saved = await this.profiles.update(r.owner, id, strip(synced));
    return saved ? { ok: true, value: saved } : { ok: false, code: "not_found" };
  }

  /** Add feeds from a signed-in app (called by ConnectService after the user picks teams or calendars). */
  async addSignedIn(owner: string, p: AthleteProfile, adds: { kind: "teamsnap" | "google"; ref: string; name: string; keywords?: string[] }[]): Promise<AthleteProfile | null> {
    const s = p.schedule || { events: [] };
    let feeds = [...(s.feeds || [])];
    const newIds: string[] = [];
    for (const a of adds) {
      const url = `${a.kind}:${a.ref}`;
      const existing = feeds.find((f) => f.url === url);
      if (existing) { feeds = feeds.map((f) => (f.url === url ? { ...f, keywords: a.keywords ?? f.keywords } : f)); newIds.push(existing.id); continue; }
      if (feeds.length >= 8) break;
      const f: CalendarFeed = { id: randomUUID(), url, kind: a.kind, app: a.kind, name: a.name.slice(0, 60), keywords: a.keywords?.length ? a.keywords : undefined };
      feeds.push(f); newIds.push(f.id);
    }
    let cur: AthleteProfile = { ...p, schedule: { ...s, feeds } };
    for (const id of newIds) cur = await this.syncOne(cur, id);
    return this.profiles.update(owner, p.id, strip(cur));
  }

  /** Drop every feed of one signed-in kind (on disconnect). */
  async removeKind(owner: string, p: AthleteProfile, kind: "teamsnap" | "google"): Promise<AthleteProfile | null> {
    const s = p.schedule || { events: [] };
    const gone = new Set((s.feeds || []).filter((f) => f.kind === kind).map((f) => f.id));
    if (!gone.size) return p;
    return this.profiles.update(owner, p.id, strip({ ...p, schedule: { ...s, feeds: (s.feeds || []).filter((f) => !gone.has(f.id)), events: (s.events || []).filter((e) => !gone.has(e.source || "")) } }));
  }

  async remove(userId: string, id: string, feedId: string): Promise<CalResult<AthleteProfile>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const s = r.p.schedule || { events: [] };
    if (!(s.feeds || []).some((f) => f.id === feedId)) return { ok: false, code: "not_found" };
    const saved = await this.profiles.update(r.owner, id, strip({
      ...r.p,
      schedule: { ...s, feeds: (s.feeds || []).filter((f) => f.id !== feedId), events: (s.events || []).filter((e) => e.source !== feedId) },
    }));
    return saved ? { ok: true, value: saved } : { ok: false, code: "not_found" };
  }

  async syncAll(userId: string, id: string): Promise<CalResult<AthleteProfile>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const saved = await this.syncProfile(r.owner, r.p);
    return saved ? { ok: true, value: saved } : { ok: false, code: "not_found" };
  }

  /** Used by the daily scheduled sync too. */
  async syncProfile(owner: string, p: AthleteProfile): Promise<AthleteProfile | null> {
    let cur = p;
    for (const f of p.schedule?.feeds || []) cur = await this.syncOne(cur, f.id);
    return this.profiles.update(owner, p.id, strip(cur));
  }

  /** Fetch one feed and replace its events on the profile (in memory). Never throws. */
  async syncOne(p: AthleteProfile, feedId: string): Promise<AthleteProfile> {
    const s = p.schedule || { events: [] };
    const feed = (s.feeds || []).find((f) => f.id === feedId);
    if (!feed) return p;
    const now = Date.now();
    let upd: CalendarFeed;
    let events = s.events || [];
    try {
      const from = now - 14 * 86_400_000, to = now + 180 * 86_400_000;
      let evs: ScheduledEvent[];
      if (feed.kind === "teamsnap" || feed.kind === "google") {
        if (!this.reader) throw new Error("Sign-in calendars aren't available right now.");
        evs = await this.reader(p, feed, from, to);
      } else {
        const text = await this.fetcher(feed.url);
        evs = toScheduled(parseIcs(text, p.timezone, from, to), feed.id, p.timezone, feed.defaultZip || p.routine?.homeZip);
      }
      events = [...events.filter((e) => e.source !== feed.id), ...evs];
      upd = { ...feed, lastSyncedAt: new Date().toISOString(), lastError: undefined, eventCount: evs.length };
    } catch (err) {
      upd = { ...feed, lastError: (err as Error).message.slice(0, 200) };
    }
    return { ...p, schedule: { ...s, events, feeds: (s.feeds || []).map((f) => (f.id === feed.id ? upd : f)) } };
  }
}
