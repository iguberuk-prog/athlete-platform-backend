/**
 * Fun layer service: fuel buddy, sticker book, game-day story, car quiz,
 * family cook night, grocery hunt, season wrapped, pre-game playlist (Spotify).
 *
 * Fun events (cook night done, quiz passed, story read) are stored as
 * app_records kind "fun_event", keyed by profile id.
 *
 * Spotify (13+): optional. Env SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET and
 * TOKEN_KEY; redirect URI {APP_URL}/api/spotify/callback. Explicit tracks are
 * always filtered out for players under 18. Without Spotify set up, the plan
 * still works with "open in Spotify" search links.
 */

import { randomBytes } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository } from "../data/repository.js";
import type { AthleteProfile, ProfileInput } from "../domain/profile.js";
import { effectiveAge } from "../domain/profile.js";
import { featuresFor, type FeatureId } from "../domain/features.js";
import { BUDDY_COLORS, PLAYLIST_GENRES, carQuiz, familyCookNight, fuelBuddy, gameDayStory, groceryHunt, playlistPlan, seasonWrapped, stickerBook, type Sticker } from "../domain/fun.js";
import { nextUp } from "../domain/dayplans.js";
import { buildGroceryList } from "../domain/grocery.js";
import { buildProgress } from "../domain/progress.js";
import { seasonRange } from "../domain/budget.js";
import type { GameLog } from "../domain/journal.js";
import { seal, unseal } from "./integrationService.js";
import type { FamilyService } from "./familyService.js";

export type FResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid" | "age" | "not_configured" | "failed"; message?: string };

interface FunEvent { kind: Sticker["kind"] | "kitchen"; date: string; note?: string; score?: number }
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const appUrl = () => (process.env.APP_URL || process.env.URL || "http://localhost:8888").replace(/\/$/, "");

export class FunService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly http: typeof fetch = fetch,
  ) {}

  private async load(userId: string, id: string) {
    const owner = await this.family.ownerFor(userId, id);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, id);
    return p ? { owner, p } : null;
  }
  private gate(p: AthleteProfile, f: FeatureId): FResult<never> | null {
    const fs = featuresFor(p);
    return fs.on[f] ? null : { ok: false, code: "age", message: fs.off[f] || "Not available at this age." };
  }
  private async events(profileId: string) {
    return (await this.records.listByKey<FunEvent>("fun_event", profileId)).map((r) => r.data);
  }
  private async addEvent(owner: string, profileId: string, e: FunEvent) {
    await this.records.put<FunEvent>({ id: `${profileId}:${e.kind}:${e.date}`, kind: "fun_event", key: profileId, ownerId: owner, data: e });
  }

  /** Buddy, stickers and tonight's story, for players 12 and under. */
  async kids(userId: string, id: string, today: string, now: string): Promise<FResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "fuelBuddy"); if (g) return g;
    const [cis, evs] = await Promise.all([this.checkins.listByProfile(r.owner, id, 400), this.events(id)]);
    const book = stickerBook(r.p, cis, evs.filter((e) => e.kind !== "kitchen") as { kind: Sticker["kind"]; date: string }[], today);
    const buddy = fuelBuddy(r.p, today, cis, book);
    const next = nextUp(r.p, now);
    const story = next && next.minutesAway <= 36 * 60 ? gameDayStory(r.p, next, buddy.name) : null;
    return { ok: true, value: { buddy, stickers: { total: book.total, perPage: book.perPage, pages: book.pages.slice(-4), newToday: book.newToday }, story, colors: BUDDY_COLORS } };
  }

  async setBuddy(userId: string, id: string, b: { name?: string; color?: string; genres?: string[] }): Promise<FResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const fun = { ...(r.p.fun || {}) };
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 20); if (!n) return { ok: false, code: "invalid", message: "Give your buddy a name." }; fun.buddyName = n; }
    if (b.color !== undefined) { if (!(BUDDY_COLORS as readonly string[]).includes(b.color)) return { ok: false, code: "invalid", message: "Pick one of the colors." }; fun.buddyColor = b.color; }
    if (b.genres !== undefined) fun.genres = (Array.isArray(b.genres) ? b.genres : []).filter((x) => (PLAYLIST_GENRES as readonly string[]).includes(x)).slice(0, 3);
    const { id: _i, ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = r.p;
    await this.profiles.update(r.owner, id, { ...(rest as ProfileInput), fun });
    return { ok: true, value: true };
  }

  /** Record a fun moment (story read, quiz score, cook night done). */
  async log(userId: string, id: string, b: { kind: string; date: string; score?: number }): Promise<FResult<{ sticker: boolean }>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    if (!["story", "quiz", "chef"].includes(b.kind) || !isDay(b.date)) return { ok: false, code: "invalid", message: "Unknown activity." };
    const score = typeof b.score === "number" ? Math.max(0, Math.min(10, Math.round(b.score))) : undefined;
    if (b.kind === "quiz" && (score ?? 0) < 7) return { ok: true, value: { sticker: false } };
    await this.addEvent(r.owner, id, { kind: b.kind as Sticker["kind"], date: b.date, score });
    return { ok: true, value: { sticker: true } };
  }

  async quiz(userId: string, id: string, seed: number): Promise<FResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    return { ok: true, value: { questions: carQuiz(r.p, seed) } };
  }

  async hunt(userId: string, id: string, from: string): Promise<FResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    return { ok: true, value: groceryHunt(buildGroceryList(r.p, from, 7).aisles) };
  }

  /** One dinner every player in the family can eat, with jobs by age. */
  async cookNight(userId: string, seed: number): Promise<FResult<unknown>> {
    const own = await this.profiles.listByOwner(userId);
    const linked = await this.family.linkedProfiles(userId);
    const players = [...own, ...linked];
    if (!players.length) return { ok: false, code: "not_found", message: "Add a player first." };
    const plan = familyCookNight(players, seed);
    if (!plan) return { ok: false, code: "invalid", message: "No dinner recipe fits everyone's food rules right now. Try the recipe list for each player." };
    return { ok: true, value: { ...plan, players: players.map((p) => ({ id: p.id, name: p.identity.fullName.split(" ")[0] })) } };
  }

  async cookNightDone(userId: string, date: string): Promise<FResult<{ players: number }>> {
    if (!isDay(date)) return { ok: false, code: "invalid" };
    const own = await this.profiles.listByOwner(userId);
    const linked = await this.family.linkedProfiles(userId);
    for (const p of [...own, ...linked]) await this.addEvent(p.ownerId, p.id, { kind: "chef", date });
    return { ok: true, value: { players: own.length + linked.length } };
  }

  async wrapped(userId: string, id: string, today: string): Promise<FResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "seasonWrapped"); if (g) return g;
    const { from, to } = seasonRange(today);
    const [cis, logs, evs, hw] = await Promise.all([
      this.checkins.listByProfile(r.owner, id, 400),
      this.records.listByKey<GameLog>("gamelog", id).then((x) => x.map((y) => y.data)),
      this.events(id),
      this.records.listByKey<{ date: string }>("homework_done", id),
    ]);
    const prog = buildProgress(r.p, { checkins: cis, reflectionDates: logs.map((l) => l.date), homeworkDates: hw.map((h) => h.data.date) }, today, { freezes: true });
    const kitchen = (await this.records.listByOwner<{ profileId: string }>("kitchen_entry", r.owner)).filter((e) => e.data.profileId === id).length;
    return { ok: true, value: seasonWrapped(r.p, cis, logs, prog, from, today < to ? today : to, { cookNights: evs.filter((e) => e.kind === "chef").length, kitchenEntries: kitchen }) };
  }

  // --- playlist (13+) ------------------------------------------------------------

  async playlist(userId: string, id: string, now: string): Promise<FResult<unknown>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "playlist"); if (g) return g;
    const plan = playlistPlan(nextUp(r.p, now), r.p.fun?.genres || []);
    const conn = await this.records.get("integration", `${id}:spotify`);
    return {
      ok: true,
      value: {
        ...plan, genres: r.p.fun?.genres || [], allGenres: PLAYLIST_GENRES, connected: !!conn,
        available: !!process.env.SPOTIFY_CLIENT_ID && !!process.env.TOKEN_KEY,
        links: plan.phases.map((ph) => ({ phase: ph.label, url: `https://open.spotify.com/search/${encodeURIComponent(ph.searchTerms[0])}/playlists` })),
        explicitFilter: (effectiveAge(r.p.identity) ?? 18) < 18,
      },
    };
  }

  async spotifyStart(userId: string, id: string): Promise<FResult<{ url: string }>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "playlist"); if (g) return g;
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.TOKEN_KEY) return { ok: false, code: "not_configured", message: "Spotify isn't set up on the server yet. Use the Open in Spotify links for now." };
    const state = randomBytes(12).toString("base64url");
    await this.records.put({ id: state, kind: "oauth_state", key: "spotify", ownerId: userId, data: { profileId: id, provider: "spotify", userId, exp: Date.now() + 15 * 60_000 } });
    const q = new URLSearchParams({ response_type: "code", client_id: process.env.SPOTIFY_CLIENT_ID, redirect_uri: `${appUrl()}/api/spotify/callback`, scope: "playlist-modify-private", state });
    return { ok: true, value: { url: `https://accounts.spotify.com/authorize?${q}` } };
  }

  private async spotifyToken(body: Record<string, string>) {
    const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET || ""}`).toString("base64");
    const res = await this.http("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`spotify token ${res.status}`);
    return { access: j.access_token as string, refresh: (j.refresh_token || body.refresh_token) as string | undefined, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
  }

  async spotifyCallback(code: string | null, state: string | null, error: string | null): Promise<string> {
    const back = (m: string) => `${appUrl()}/#/fun?${m}`;
    if (!state) return back("spotify=error");
    const st = await this.records.get<{ profileId: string; userId: string; exp: number }>("oauth_state", state);
    if (st) await this.records.delete("oauth_state", state);
    if (!st || st.data.exp < Date.now() || error || !code) return back("spotify=error");
    try {
      const t = await this.spotifyToken({ grant_type: "authorization_code", code, redirect_uri: `${appUrl()}/api/spotify/callback` });
      const owner = await this.family.ownerFor(st.data.userId, st.data.profileId);
      if (!owner) return back("spotify=error");
      await this.records.put({ id: `${st.data.profileId}:spotify`, kind: "integration", key: st.data.profileId, ownerId: owner, data: { provider: "spotify", profileId: st.data.profileId, sealed: seal(t), connectedAt: new Date().toISOString() } });
      return back("spotify=connected");
    } catch {
      return back("spotify=error");
    }
  }

  /** Build the playlist in the player's Spotify account. */
  async buildSpotify(userId: string, id: string, now: string): Promise<FResult<{ url: string; tracks: number }>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    const g = this.gate(r.p, "playlist"); if (g) return g;
    const rec = await this.records.get<{ sealed: string }>("integration", `${id}:spotify`);
    if (!rec) return { ok: false, code: "invalid", message: "Connect Spotify first." };
    try {
      let t = unseal<{ access: string; refresh?: string; expiresAt: number }>(rec.data.sealed);
      if (t.expiresAt < Date.now() && t.refresh) {
        t = await this.spotifyToken({ grant_type: "refresh_token", refresh_token: t.refresh });
        await this.records.put({ id: rec.id, kind: "integration", key: rec.key, ownerId: rec.ownerId, data: { ...rec.data, sealed: seal(t) } });
      }
      const api = async (path: string, init: RequestInit = {}) => {
        const res = await this.http(`https://api.spotify.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${t.access}`, "Content-Type": "application/json" } });
        if (!res.ok) throw new Error(`spotify ${res.status}`);
        return res.json() as Promise<any>;
      };
      const noExplicit = (effectiveAge(r.p.identity) ?? 18) < 18;
      const plan = playlistPlan(nextUp(r.p, now), r.p.fun?.genres || []);
      const uris: string[] = [];
      for (const ph of plan.phases) {
        let ms = 0;
        for (const term of ph.searchTerms) {
          if (ms >= ph.minutes * 60_000) break;
          const res = await api(`/search?type=track&limit=30&q=${encodeURIComponent(term)}`);
          for (const tr of res.tracks?.items || []) {
            if (ms >= ph.minutes * 60_000) break;
            if ((noExplicit && tr.explicit) || uris.includes(tr.uri)) continue;
            uris.push(tr.uri); ms += tr.duration_ms || 180_000;
          }
        }
      }
      if (!uris.length) return { ok: false, code: "failed", message: "Couldn't find songs. Try other genres." };
      const me = await api("/me");
      const pl = await api(`/users/${encodeURIComponent(me.id)}/playlists`, { method: "POST", body: JSON.stringify({ name: plan.title, public: false, description: "Pre-game meal, then focus, then warm-up hype. Made by Athlete Performance." }) });
      for (let i = 0; i < uris.length; i += 100) await api(`/playlists/${pl.id}/tracks`, { method: "POST", body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
      return { ok: true, value: { url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`, tracks: uris.length } };
    } catch (err) {
      console.warn("spotify build failed", (err as Error).message);
      return { ok: false, code: "failed", message: "Spotify didn't answer. Try reconnecting." };
    }
  }

  async spotifyDisconnect(userId: string, id: string): Promise<FResult<true>> {
    const r = await this.load(userId, id);
    if (!r) return { ok: false, code: "not_found" };
    await this.records.delete("integration", `${id}:spotify`);
    return { ok: true, value: true };
  }
}
