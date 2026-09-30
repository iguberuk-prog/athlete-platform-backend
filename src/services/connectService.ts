/**
 * Sign in with a team app and bring its schedule in.
 *
 *   TeamSnap        OAuth 2 (auth.teamsnap.com), API v3. Reads the user's teams and their events.
 *   Google Calendar OAuth 2, read-only calendar scope. Reads the calendars the family picks,
 *                   so any app that already writes games to Google (Spond, BAND, school sites) works.
 *
 * Tokens are sealed with TOKEN_KEY and kept per player in app_records
 * ("integration", id "<profileId>:teamsnap"). Events land on the profile as
 * schedule feeds, so the daily sync, weather, reminders and overuse guard
 * treat them like any other team calendar.
 *
 * Redirect URIs to register:
 *   {APP_URL}/api/connect/teamsnap/callback
 *   {APP_URL}/api/connect/google/callback
 */

import { randomBytes } from "node:crypto";
import type { AthleteProfileRepository, RecordRepository } from "../data/repository.js";
import type { AthleteProfile, CalendarFeed, ScheduledEvent } from "../domain/profile.js";
import { TEAM_APPS, cj, googleToScheduled, teamsnapToScheduled, type CjItem } from "../domain/teamApps.js";
import type { FamilyService } from "./familyService.js";
import type { CalendarService } from "./calendarService.js";
import { seal, unseal } from "./integrationService.js";

export type SignIn = "teamsnap" | "google";
type Tokens = { access: string; refresh?: string; expiresAt: number; userId?: string };
interface Conn { provider: SignIn; profileId: string; sealed: string; connectedAt: string; account?: string }
export type CResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid" | "not_configured" | "not_connected" | "failed"; message?: string };

const appUrl = () => (process.env.APP_URL || process.env.URL || "http://localhost:8888").replace(/\/$/, "");
const redirect = (p: SignIn) => `${appUrl()}/api/connect/${p}/callback`;

const CFG: Record<SignIn, { name: string; auth: string; token: string; scope: string; id: () => string | undefined; secret: () => string | undefined }> = {
  teamsnap: {
    name: "TeamSnap", auth: "https://auth.teamsnap.com/oauth/authorize", token: "https://auth.teamsnap.com/oauth/token", scope: "read",
    id: () => process.env.TEAMSNAP_CLIENT_ID, secret: () => process.env.TEAMSNAP_CLIENT_SECRET,
  },
  google: {
    name: "Google Calendar", auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    id: () => process.env.GOOGLE_CLIENT_ID, secret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
};
const TS_API = "https://api.teamsnap.com/v3";
const G_API = "https://www.googleapis.com/calendar/v3";

export class ConnectService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly calendar: CalendarService,
    private readonly http: typeof fetch = fetch,
  ) {
    calendar.setReader((p, feed, from, to) => this.read(p, feed, from, to));
  }

  private async load(userId: string, id: string) {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }
  configured = (p: SignIn) => !!CFG[p].id() && !!CFG[p].secret() && !!process.env.TOKEN_KEY;

  /** Every team app, with what's connected for this player. */
  async overview(userId: string, id: string): Promise<CResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const conns: Record<string, { account?: string; connectedAt: string } | null> = {};
    for (const p of ["teamsnap", "google"] as SignIn[]) {
      const c = await this.records.get<Conn>("integration", `${id}:${p}`).catch(() => null);
      conns[p] = c ? { account: c.data.account, connectedAt: c.data.connectedAt } : null;
    }
    return {
      ok: true,
      value: {
        apps: TEAM_APPS.map((a) => ({ ...a, available: a.kind !== "signin" || this.configured(a.id as SignIn), connected: a.kind === "signin" ? conns[a.id] : undefined })),
        feeds: r.p.schedule?.feeds || [],
        upcoming: (r.p.schedule?.events || []).filter((e) => e.source && e.source !== "manual" && e.startTime >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 5),
      },
    };
  }

  async start(userId: string, id: string, p: SignIn): Promise<CResult<{ url: string }>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (!this.configured(p)) return { ok: false, code: "not_configured", message: `${CFG[p].name} sign-in isn't set up on the server yet. Paste the calendar link instead.` };
    const state = randomBytes(16).toString("base64url");
    await this.records.put({ id: state, kind: "oauth_state", key: p, ownerId: userId, data: { profileId: id, provider: p, userId, exp: Date.now() + 15 * 60_000 } });
    const q = new URLSearchParams({ response_type: "code", client_id: CFG[p].id()!, redirect_uri: redirect(p), scope: CFG[p].scope, state });
    if (p === "google") { q.set("access_type", "offline"); q.set("prompt", "consent"); q.set("include_granted_scopes", "true"); }
    return { ok: true, value: { url: `${CFG[p].auth}?${q}` } };
  }

  private async token(p: SignIn, body: Record<string, string>): Promise<Tokens> {
    const res = await this.http(CFG[p].token, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...body, client_id: CFG[p].id() || "", client_secret: CFG[p].secret() || "" }).toString(),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`${p} token ${res.status}`);
    return { access: j.access_token, refresh: j.refresh_token || body.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 7200) * 1000 - 60_000 };
  }

  /** Where the browser goes after the provider sends the user back. */
  async callback(p: SignIn, code: string | null, state: string | null, error: string | null): Promise<string> {
    const back = (m: string) => `${appUrl()}/#/connect?${m}`;
    if (!state) return back("error=1");
    const st = await this.records.get<{ profileId: string; userId: string; provider: string; exp: number }>("oauth_state", state);
    if (st) await this.records.delete("oauth_state", state);
    if (!st || st.data.provider !== p || st.data.exp < Date.now()) return back("error=expired");
    if (error || !code) return back("error=denied");
    try {
      const t = await this.token(p, { grant_type: "authorization_code", code, redirect_uri: redirect(p) });
      const owner = await this.family.ownerFor(st.data.userId, st.data.profileId);
      if (!owner) return back("error=1");
      let account: string | undefined;
      if (p === "teamsnap") {
        const me = cj(((await this.get(`${TS_API}/me`, t.access)).collection?.items || [])[0] || { data: [] });
        t.userId = String(me.id || ""); account = me.email || [me.first_name, me.last_name].filter(Boolean).join(" ") || undefined;
      } else {
        const prim = await this.get(`${G_API}/calendars/primary`, t.access).catch(() => null);
        account = prim?.id;
      }
      await this.records.put<Conn>({ id: `${st.data.profileId}:${p}`, kind: "integration", key: st.data.profileId, ownerId: owner, data: { provider: p, profileId: st.data.profileId, sealed: seal(t), connectedAt: new Date().toISOString(), account } });
      return back(`connected=${p}`);
    } catch {
      return back("error=failed");
    }
  }

  private async get(url: string, access: string): Promise<any> {
    const res = await this.http(url, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } });
    if (res.status === 401) throw Object.assign(new Error("reconnect"), { reconnect: true });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return res.json();
  }

  /** A fresh access token for this player's connection (refreshes and re-seals when needed). */
  private async access(profileId: string, p: SignIn): Promise<Tokens | null> {
    const rec = await this.records.get<Conn>("integration", `${profileId}:${p}`);
    if (!rec) return null;
    let t = unseal<Tokens>(rec.data.sealed);
    if (t.expiresAt < Date.now() && t.refresh) {
      t = { ...(await this.token(p, { grant_type: "refresh_token", refresh_token: t.refresh })), userId: t.userId };
      await this.records.put<Conn>({ ...rec, data: { ...rec.data, sealed: seal(t) } });
    }
    return t;
  }

  /** Teams (TeamSnap) or calendars (Google) the family can pick from. */
  async options(userId: string, id: string, p: SignIn): Promise<CResult<{ items: { id: string; name: string; sub?: string; picked: boolean }[] }>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    try {
      const t = await this.access(id, p);
      if (!t) return { ok: false, code: "not_connected", message: `Sign in with ${CFG[p].name} first.` };
      const picked = new Set((r.p.schedule?.feeds || []).filter((f) => f.kind === p).map((f) => f.url.slice(p.length + 1)));
      if (p === "teamsnap") {
        const j = await this.get(`${TS_API}/teams/search?user_id=${encodeURIComponent(t.userId || "")}`, t.access);
        const items = (j.collection?.items || []).map((i: CjItem) => cj(i)).filter((x: any) => !x.is_archived_season);
        return { ok: true, value: { items: items.map((x: any) => ({ id: String(x.id), name: String(x.name || "Team"), sub: [x.season_name, x.division_name].filter(Boolean).join(" · ") || undefined, picked: picked.has(String(x.id)) })) } };
      }
      const j = await this.get(`${G_API}/users/me/calendarList?minAccessRole=reader&maxResults=100`, t.access);
      return { ok: true, value: { items: (j.items || []).map((c: any) => ({ id: String(c.id), name: String(c.summaryOverride || c.summary || c.id), sub: c.primary ? "Main calendar" : undefined, picked: picked.has(String(c.id)) })) } };
    } catch (e) {
      return (e as any).reconnect ? { ok: false, code: "not_connected", message: `Please sign in with ${CFG[p].name} again.` } : { ok: false, code: "failed", message: `${CFG[p].name} didn't answer. Try again in a minute.` };
    }
  }

  /** Save the picked teams or calendars and bring their events in now. */
  async choose(userId: string, id: string, p: SignIn, picks: { id: string; name: string }[], keywords?: string[]): Promise<CResult<AthleteProfile>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (!Array.isArray(picks) || !picks.length || picks.length > 6) return { ok: false, code: "invalid", message: "Pick 1 to 6." };
    if (!(await this.records.get("integration", `${id}:${p}`))) return { ok: false, code: "not_connected", message: `Sign in with ${CFG[p].name} first.` };
    const kw = (keywords || []).map((k) => String(k).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    // Unpicked feeds of this kind go away with their events.
    const keep = new Set(picks.map((x) => `${p}:${x.id}`));
    const s = r.p.schedule || { events: [] };
    const drop = new Set((s.feeds || []).filter((f) => f.kind === p && !keep.has(f.url)).map((f) => f.id));
    const base: AthleteProfile = { ...r.p, schedule: { ...s, feeds: (s.feeds || []).filter((f) => !drop.has(f.id)), events: (s.events || []).filter((e) => !drop.has(e.source || "")) } };
    const saved = await this.calendar.addSignedIn(r.owner, base, picks.map((x) => ({ kind: p, ref: String(x.id).slice(0, 300), name: String(x.name || CFG[p].name), keywords: p === "google" ? kw : undefined })));
    return saved ? { ok: true, value: saved } : { ok: false, code: "not_found" };
  }

  async disconnect(userId: string, id: string, p: SignIn): Promise<CResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    await this.records.delete("integration", `${id}:${p}`);
    await this.calendar.removeKind(r.owner, r.p, p);
    return { ok: true, value: true };
  }

  /** Reader used by CalendarService.syncOne for signed-in feeds. */
  async read(p: AthleteProfile, feed: CalendarFeed, from: number, to: number): Promise<ScheduledEvent[]> {
    const kind = feed.kind as SignIn;
    const ref = feed.url.slice(kind.length + 1);
    let t: Tokens | null;
    try { t = await this.access(p.id, kind); } catch { throw new Error(`${CFG[kind].name} sign-in expired. Sign in again.`); }
    if (!t) throw new Error(`Not signed in to ${CFG[kind].name}.`);
    const zip = feed.defaultZip || p.routine?.homeZip;
    try {
      if (kind === "teamsnap") {
        const j = await this.get(`${TS_API}/events/search?team_id=${encodeURIComponent(ref)}`, t.access);
        return teamsnapToScheduled((j.collection?.items || []).map((i: CjItem) => cj(i)), feed.id, p.timezone, from, to, zip);
      }
      const items: any[] = [];
      let page: string | undefined;
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
        if (page) q.set("pageToken", page);
        const j = await this.get(`${G_API}/calendars/${encodeURIComponent(ref)}/events?${q}`, t.access);
        items.push(...(j.items || []));
        page = j.nextPageToken; if (!page) break;
      }
      return googleToScheduled(items, feed.id, p.timezone, feed.keywords || [], zip);
    } catch (e) {
      throw new Error((e as any).reconnect ? `${CFG[kind].name} sign-in expired. Sign in again.` : `${CFG[kind].name} didn't answer (${(e as Error).message}).`);
    }
  }
}
