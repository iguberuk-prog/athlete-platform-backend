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
import type { AthleteProfile, CalendarFeed, ProfileInput } from "../domain/profile.js";
import { parseIcs, toScheduled } from "../domain/ics.js";
import { isFeedUrl } from "../domain/validation.js";
import type { FamilyService } from "./familyService.js";

const MAX_BYTES = 2_000_000;

export async function fetchFeed(url: string): Promise<string> {
  const https = url.replace(/^webcal:/i, "https:");
  if (!isFeedUrl(https)) throw new Error("That doesn't look like a calendar link.");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(https, { signal: ctl.signal, headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "AthletePerformance/1.0 calendar-sync" } });
    if (!isFeedUrl(res.url || https)) throw new Error("The calendar link redirected somewhere we can't use.");
    if (!res.ok) throw new Error(`The calendar site answered ${res.status}. Check the link.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("That calendar is too large.");
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That link isn't a calendar feed. Look for 'Subscribe' or 'Export calendar' in your team app.");
    return text;
  } finally {
    clearTimeout(t);
  }
}

const strip = (p: AthleteProfile): ProfileInput => {
  const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = p;
  return rest;
};

export type CalResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid"; message?: string };

export class CalendarService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly fetcher: (url: string) => Promise<string> = fetchFeed,
  ) {}

  private async load(userId: string, id: string) {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }

  async add(userId: string, id: string, url: string, name?: string, defaultZip?: string): Promise<CalResult<AthleteProfile>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (!isFeedUrl(String(url || "").replace(/^webcal:/i, "https:"))) return { ok: false, code: "invalid", message: "Paste the calendar's subscribe link (it starts with webcal:// or https://)." };
    if (defaultZip && !/^\d{5}$/.test(defaultZip)) return { ok: false, code: "invalid", message: "ZIP must be 5 digits." };
    const feeds = r.p.schedule?.feeds || [];
    if (feeds.length >= 6) return { ok: false, code: "invalid", message: "Up to 6 team calendars per player." };
    if (feeds.some((f) => f.url === url)) return { ok: false, code: "invalid", message: "That calendar is already added." };
    const feed: CalendarFeed = { id: randomUUID(), url: url.trim(), name: String(name || "Team calendar").slice(0, 60), defaultZip: defaultZip || undefined };
    const synced = await this.syncOne({ ...r.p, schedule: { ...(r.p.schedule || { events: [] }), feeds: [...feeds, feed] } }, feed.id);
    const saved = await this.profiles.update(r.owner, id, strip(synced));
    return saved ? { ok: true, value: saved } : { ok: false, code: "not_found" };
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
      const text = await this.fetcher(feed.url);
      const evs = toScheduled(parseIcs(text, p.timezone, now - 14 * 86_400_000, now + 180 * 86_400_000), feed.id, p.timezone, feed.defaultZip || p.routine?.homeZip);
      events = [...events.filter((e) => e.source !== feed.id), ...evs];
      upd = { ...feed, lastSyncedAt: new Date().toISOString(), lastError: undefined, eventCount: evs.length };
    } catch (err) {
      upd = { ...feed, lastError: (err as Error).message.slice(0, 200) };
    }
    return { ...p, schedule: { ...s, events, feeds: (s.feeds || []).map((f) => (f.id === feed.id ? upd : f)) } };
  }
}
