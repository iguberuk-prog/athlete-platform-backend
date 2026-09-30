/**
 * Wearable connections: Whoop and Oura end to end (OAuth 2.0), Garmin ready
 * for when Garmin approves the app, Apple Health through the iPhone app.
 *
 *   start()      -> the provider's sign-in page (with a one-time state)
 *   callback()   -> exchanges the code, stores tokens ENCRYPTED (AES-256-GCM)
 *   sync()       -> pulls the last days of sleep, resting HR and HRV into
 *                   check-ins, never overwriting what the player typed
 *   disconnect() -> deletes the tokens (and revokes them at Whoop)
 *
 * Env: APP_URL, TOKEN_KEY (any long random string),
 *      WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET, OURA_CLIENT_ID / OURA_CLIENT_SECRET.
 * Redirect URI to register with each provider:
 *      {APP_URL}/api/integrations/whoop/callback  and  .../oura/callback
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AthleteProfileRepository, CheckInRepository, RecordRepository } from "../data/repository.js";
import type { CheckInInput } from "../domain/checkin.js";
import { featuresFor, type FeatureId } from "../domain/features.js";
import type { FamilyService } from "./familyService.js";

export type Provider = "whoop" | "oura" | "garmin";

interface ProviderConfig {
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
  env: string;
  feature: FeatureId;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  whoop: { name: "Whoop", authUrl: "https://api.prod.whoop.com/oauth/oauth2/auth", tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token", scopes: "read:recovery read:sleep read:cycles read:workout offline", env: "WHOOP", feature: "whoop" },
  oura: { name: "Oura", authUrl: "https://cloud.ouraring.com/oauth/authorize", tokenUrl: "https://api.ouraring.com/oauth/token", scopes: "daily heartrate", env: "OURA", feature: "oura" },
  garmin: { name: "Garmin", authUrl: "https://connect.garmin.com/oauth2Confirm", tokenUrl: "https://diauth.garmin.com/di-oauth2-service/oauth/token", scopes: "", env: "GARMIN", feature: "garmin" },
};

export const isProvider = (v: unknown): v is Provider => v === "whoop" || v === "oura" || v === "garmin";

// --- token encryption -------------------------------------------------------

function key(): Buffer {
  const k = process.env.TOKEN_KEY;
  if (!k || k.length < 16) throw new Error("TOKEN_KEY is not set");
  return createHash("sha256").update(k).digest();
}

export function seal(obj: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function unseal<T>(s: string): T {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8")) as T;
}

interface Tokens { access: string; refresh?: string; expiresAt: number }
interface IntegrationData { provider: Provider; profileId: string; sealed: string; connectedAt: string; lastSyncAt?: string; lastError?: string }
interface StateData { profileId: string; provider: Provider; userId: string; exp: number }

const clientId = (p: Provider) => process.env[`${PROVIDERS[p].env}_CLIENT_ID`] || "";
const clientSecret = (p: Provider) => process.env[`${PROVIDERS[p].env}_CLIENT_SECRET`] || "";
const appUrl = () => (process.env.APP_URL || process.env.URL || "http://localhost:8888").replace(/\/$/, "");
const redirectUri = (p: Provider) => `${appUrl()}/api/integrations/${p}/callback`;

export type IntResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid" | "age" | "not_configured" | "failed"; message?: string };

type Fetch = typeof fetch;

export class IntegrationService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly http: Fetch = fetch,
  ) {}

  private async owned(userId: string, profileId: string) {
    const owner = await this.family.ownerFor(userId, profileId);
    if (!owner) return null;
    const p = await this.profiles.getById(owner, profileId);
    return p ? { owner, p } : null;
  }

  /** Which devices this player can connect, and which are connected. */
  async list(userId: string, profileId: string) {
    const r = await this.owned(userId, profileId);
    if (!r) return { ok: false as const, code: "not_found" as const };
    const f = featuresFor(r.p);
    const out = [];
    for (const p of ["whoop", "oura", "garmin"] as Provider[]) {
      const rec = await this.records.get<IntegrationData>("integration", `${profileId}:${p}`);
      out.push({
        provider: p, name: PROVIDERS[p].name,
        allowed: f.on[PROVIDERS[p].feature], why: f.off[PROVIDERS[p].feature],
        available: p === "garmin" ? !!clientId("garmin") && process.env.GARMIN_APPROVED === "1" : !!clientId(p) && !!process.env.TOKEN_KEY,
        connected: !!rec, lastSyncAt: rec?.data.lastSyncAt, lastError: rec?.data.lastError,
      });
    }
    return { ok: true as const, value: { devices: out, appleHealth: f.on.appleHealth } };
  }

  async start(userId: string, profileId: string, provider: Provider): Promise<IntResult<{ url: string }>> {
    const r = await this.owned(userId, profileId);
    if (!r) return { ok: false, code: "not_found" };
    const f = featuresFor(r.p);
    if (!f.on[PROVIDERS[provider].feature]) return { ok: false, code: "age", message: f.off[PROVIDERS[provider].feature] };
    if (provider === "garmin" && process.env.GARMIN_APPROVED !== "1") return { ok: false, code: "not_configured", message: "Garmin connection is waiting on Garmin's approval. Use Apple Health for now: Garmin Connect can sync into it." };
    if (!clientId(provider) || !process.env.TOKEN_KEY) return { ok: false, code: "not_configured", message: `${PROVIDERS[provider].name} isn't set up on the server yet.` };
    const state = randomBytes(12).toString("base64url");
    await this.records.put<StateData>({ id: state, kind: "oauth_state", key: provider, ownerId: userId, data: { profileId, provider, userId, exp: Date.now() + 15 * 60_000 } });
    const q = new URLSearchParams({ response_type: "code", client_id: clientId(provider), redirect_uri: redirectUri(provider), scope: PROVIDERS[provider].scopes, state });
    return { ok: true, value: { url: `${PROVIDERS[provider].authUrl}?${q}` } };
  }

  /** Browser lands here after the provider's sign-in. Returns where to send the user. */
  async callback(provider: Provider, code: string | null, state: string | null, error: string | null): Promise<string> {
    const back = (msg: string) => `${appUrl()}/#/devices?${msg}`;
    if (!state) return back("error=missing_state");
    const st = await this.records.get<StateData>("oauth_state", state);
    if (st) await this.records.delete("oauth_state", state);
    if (!st || st.data.provider !== provider || st.data.exp < Date.now()) return back("error=expired");
    if (error || !code) return back(`error=${encodeURIComponent(error || "cancelled")}`);
    try {
      const tokens = await this.exchange(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
      const owner = await this.family.ownerFor(st.data.userId, st.data.profileId);
      if (!owner) return back("error=profile");
      await this.records.put<IntegrationData>({
        id: `${st.data.profileId}:${provider}`, kind: "integration", key: st.data.profileId, ownerId: owner,
        data: { provider, profileId: st.data.profileId, sealed: seal(tokens), connectedAt: new Date().toISOString() },
      });
      await this.sync(st.data.userId, st.data.profileId, provider, 7).catch(() => undefined);
      return back(`connected=${provider}`);
    } catch (err) {
      console.warn("oauth exchange failed", provider, (err as Error).message);
      return back("error=exchange");
    }
  }

  private async exchange(provider: Provider, body: Record<string, string>): Promise<Tokens> {
    const res = await this.http(PROVIDERS[provider].tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, client_id: clientId(provider), client_secret: clientSecret(provider) }).toString(),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`token ${res.status}`);
    return { access: j.access_token, refresh: j.refresh_token || body.refresh_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
  }

  private async tokens(rec: { id: string; key: string; ownerId: string; data: IntegrationData }): Promise<Tokens> {
    let t = unseal<Tokens>(rec.data.sealed);
    if (t.expiresAt > Date.now()) return t;
    if (!t.refresh) throw new Error("expired");
    // Oura refresh tokens are single-use: always store the new one.
    t = await this.exchange(rec.data.provider, { grant_type: "refresh_token", refresh_token: t.refresh, ...(rec.data.provider === "whoop" ? { scope: "offline" } : {}) });
    await this.records.put<IntegrationData>({ id: rec.id, kind: "integration", key: rec.key, ownerId: rec.ownerId, data: { ...rec.data, sealed: seal(t) } });
    return t;
  }

  private async get(url: string, t: Tokens): Promise<any> {
    const res = await this.http(url, { headers: { Authorization: `Bearer ${t.access}` } });
    if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
    return res.json();
  }

  /** Pull recent days into check-ins. */
  async sync(userId: string, profileId: string, provider: Provider, days = 7): Promise<IntResult<{ days: number }>> {
    const r = await this.owned(userId, profileId);
    if (!r) return { ok: false, code: "not_found" };
    const rec = await this.records.get<IntegrationData>("integration", `${profileId}:${provider}`);
    if (!rec) return { ok: false, code: "not_found", message: "Not connected." };
    try {
      const t = await this.tokens(rec);
      const end = new Date();
      const start = new Date(end.getTime() - days * 86_400_000);
      const rows = provider === "whoop" ? await this.whoop(t, start, end) : provider === "oura" ? await this.oura(t, start, end) : [];
      for (const row of rows) await this.merge(r.owner, profileId, row, provider);
      await this.records.put<IntegrationData>({ id: rec.id, kind: "integration", key: rec.key, ownerId: rec.ownerId, data: { ...rec.data, sealed: (await this.records.get<IntegrationData>("integration", rec.id))!.data.sealed, lastSyncAt: new Date().toISOString(), lastError: undefined } });
      return { ok: true, value: { days: rows.length } };
    } catch (err) {
      await this.records.put<IntegrationData>({ id: rec.id, kind: "integration", key: rec.key, ownerId: rec.ownerId, data: { ...rec.data, lastError: (err as Error).message.slice(0, 120) } });
      return { ok: false, code: "failed", message: `Couldn't sync ${PROVIDERS[provider].name}. Try reconnecting.` };
    }
  }

  private async whoop(t: Tokens, start: Date, end: Date): Promise<Row[]> {
    const base = "https://api.prod.whoop.com/developer/v2";
    const q = `start=${start.toISOString()}&end=${end.toISOString()}&limit=25`;
    const [rec, sleep] = await Promise.all([this.get(`${base}/recovery?${q}`, t), this.get(`${base}/activity/sleep?${q}`, t)]);
    const byDay = new Map<string, Row>();
    const dayOf = (iso: string, off?: string) => localDay(iso, off);
    for (const s of sleep.records || []) {
      if (s.nap || s.score_state !== "SCORED" || !s.score?.stage_summary) continue;
      const ss = s.score.stage_summary;
      const hrs = (ss.total_in_bed_time_milli - (ss.total_awake_time_milli || 0)) / 3_600_000;
      const d = dayOf(s.end, s.timezone_offset);
      byDay.set(d, { ...(byDay.get(d) || { date: d }), sleepHours: Math.round(hrs * 10) / 10, sleepId: s.id });
    }
    for (const x of rec.records || []) {
      if (x.score_state !== "SCORED" || !x.score) continue;
      const row = [...byDay.values()].find((v) => v.sleepId === x.sleep_id);
      const d = row?.date || dayOf(x.created_at);
      byDay.set(d, { ...(byDay.get(d) || { date: d }), restingHr: Math.round(x.score.resting_heart_rate), hrv: Math.round(x.score.hrv_rmssd_milli) });
    }
    return [...byDay.values()];
  }

  private async oura(t: Tokens, start: Date, end: Date): Promise<Row[]> {
    const q = `start_date=${start.toISOString().slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}`;
    const j = await this.get(`https://api.ouraring.com/v2/usercollection/sleep?${q}`, t);
    const byDay = new Map<string, Row>();
    for (const s of j.data || []) {
      if (s.type !== "long_sleep") continue;
      const prev = byDay.get(s.day);
      if (prev && (prev.sleepHours ?? 0) * 3600 > (s.total_sleep_duration || 0)) continue;
      byDay.set(s.day, {
        date: s.day,
        sleepHours: s.total_sleep_duration ? Math.round((s.total_sleep_duration / 3600) * 10) / 10 : undefined,
        restingHr: s.lowest_heart_rate ? Math.round(s.lowest_heart_rate) : undefined,
        hrv: s.average_hrv ? Math.round(s.average_hrv) : undefined,
      });
    }
    return [...byDay.values()];
  }

  /** Fill blanks in the day's check-in; never overwrite what the player typed. */
  private async merge(owner: string, profileId: string, row: Row, provider: Provider): Promise<void> {
    const cur = await this.checkins.getByDate(owner, profileId, row.date);
    const base: CheckInInput = cur ? (({ id: _i, ownerId: _o, createdAt: _c, ...rest }) => rest)(cur) : { profileId, date: row.date };
    const next: CheckInInput = { ...base };
    if (base.sleepHoursLastNight === undefined && row.sleepHours !== undefined && row.sleepHours > 0 && row.sleepHours <= 16) next.sleepHoursLastNight = row.sleepHours;
    if (base.restingHeartRate === undefined && row.restingHr && row.restingHr >= 30 && row.restingHr <= 120) next.restingHeartRate = row.restingHr;
    if (base.hrvMs === undefined && row.hrv && row.hrv > 0 && row.hrv <= 250) next.hrvMs = row.hrv;
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    next.source = base.source || provider;
    await this.checkins.upsert(owner, next);
  }

  async disconnect(userId: string, profileId: string, provider: Provider): Promise<IntResult<true>> {
    const r = await this.owned(userId, profileId);
    if (!r) return { ok: false, code: "not_found" };
    const rec = await this.records.get<IntegrationData>("integration", `${profileId}:${provider}`);
    if (!rec) return { ok: false, code: "not_found" };
    if (provider === "whoop") {
      try { const t = unseal<Tokens>(rec.data.sealed); await this.http("https://api.prod.whoop.com/developer/v2/user/access", { method: "DELETE", headers: { Authorization: `Bearer ${t.access}` } }); } catch { /* best effort */ }
    }
    await this.records.delete("integration", rec.id);
    return { ok: true, value: true };
  }

  /** Daily job: sync every connection. */
  async syncAll(budgetMs = 20_000): Promise<number> {
    const t0 = Date.now();
    let n = 0;
    for (const rec of await this.records.listByKind<IntegrationData>("integration", 500)) {
      if (Date.now() - t0 > budgetMs) break;
      if (rec.data.provider !== "whoop" && rec.data.provider !== "oura") continue;
      const res = await this.sync(rec.ownerId, rec.data.profileId, rec.data.provider, 3).catch(() => null);
      if (res?.ok) n++;
    }
    return n;
  }
}

interface Row { date: string; sleepHours?: number; restingHr?: number; hrv?: number; sleepId?: string }

/** "2026-09-28T11:02:00.000Z" + "-04:00" -> local "2026-09-28". */
function localDay(iso: string, off?: string): string {
  const ms = Date.parse(iso);
  const m = (off || "").match(/^([+-])(\d{2}):?(\d{2})$/);
  const shift = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(ms + shift * 60_000).toISOString().slice(0, 10);
}
