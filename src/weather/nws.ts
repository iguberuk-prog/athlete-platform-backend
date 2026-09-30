/**
 * Forecast provider: US National Weather Service (api.weather.gov).
 *
 * Free, public-domain, no API key. Covers the US (the app's market today).
 * Per ZIP code: ZIP -> lat/lon (bundled Census ZIP centroids) -> NWS grid point
 * -> hourly gridded forecast, which includes temperature, apparent ("feels
 * like") temperature, humidity, wind and WBGT, about 7 days out.
 *
 * Times come back in UTC; we convert to the location's own time zone so they
 * line up with local game times. Results are cached in memory (grid points
 * for a day, forecasts for 30 minutes). Any failure returns null and the app
 * simply plans without weather.
 */

import ZIPS from "../data/zipCentroids.js";
import type { WeatherHour, WxAlert } from "../domain/weather.js";

let CENTROIDS: Record<string, [number, number]> | null = null;
function centroids(): Record<string, [number, number]> {
  if (CENTROIDS) return CENTROIDS;
  CENTROIDS = {};
  for (const row of ZIPS.split(";")) {
    const [z, lat, lon] = row.split(",");
    CENTROIDS[z] = [Number(lat), Number(lon)];
  }
  return CENTROIDS;
}
const UA = process.env.NWS_USER_AGENT || "AthletePerformanceApp (support@example.com)";

export function zipToLatLon(zip: string): [number, number] | null {
  return centroids()[String(zip).trim().slice(0, 5)] || null;
}

export const isKnownZip = (zip: unknown) => typeof zip === "string" && /^\d{5}$/.test(zip) && !!centroids()[zip];

export interface Forecast {
  zip: string;
  place?: string;
  timeZone: string;
  hours: WeatherHour[];
  alerts?: WxAlert[];
}

export interface WeatherProvider {
  forecast(zip: string): Promise<Forecast | null>;
}

interface Point { grid: string; timeZone: string; place?: string }
const pointCache = new Map<string, { at: number; v: Point }>();
const fcCache = new Map<string, { at: number; v: Forecast }>();

async function getJson(url: string, ms = 5000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** "PT1H" / "P1DT6H" -> hours. */
function durationHours(iso: string): number {
  const m = iso.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/);
  if (!m) return 1;
  return Math.max(1, Number(m[1] || 0) * 24 + Number(m[2] || 0));
}

/** Expand an NWS time series into { utcHourMs: value }. */
function expand(series: any, conv: (v: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of series?.values || []) {
    if (e.value === null || e.value === undefined) continue;
    const [start, dur] = String(e.validTime).split("/");
    const t0 = Date.parse(start);
    const n = durationHours(dur || "PT1H");
    for (let i = 0; i < n; i++) out.set(t0 + i * 3_600_000, conv(Number(e.value)));
  }
  return out;
}

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);
const kmhToMph = (k: number) => Math.round(k * 0.621371);

function localHour(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (k: string) => parts.find((p) => p.type === k)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:00`;
}

export class NwsProvider implements WeatherProvider {
  async forecast(zip: string): Promise<Forecast | null> {
    const ll = zipToLatLon(zip);
    if (!ll) return null;
    const cached = fcCache.get(zip);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.v;
    try {
      const key = `${ll[0]},${ll[1]}`;
      let pt = pointCache.get(key);
      if (!pt || Date.now() - pt.at > 24 * 3_600_000) {
        const p = (await getJson(`https://api.weather.gov/points/${ll[0]},${ll[1]}`)).properties;
        const rel = p.relativeLocation?.properties;
        pt = { at: Date.now(), v: { grid: p.forecastGridData, timeZone: p.timeZone, place: rel ? `${rel.city}, ${rel.state}` : undefined } };
        pointCache.set(key, pt);
      }
      const g = (await getJson(pt.v.grid, 7000)).properties;
      const temp = expand(g.temperature, cToF);
      const feels = expand(g.apparentTemperature, cToF);
      const hum = expand(g.relativeHumidity, (v) => v);
      const wbgt = expand(g.wetBulbGlobeTemperature, cToF);
      const wind = expand(g.windSpeed, kmhToMph);
      const pop = expand(g.probabilityOfPrecipitation, (v) => v);
      const thunder = expand(g.probabilityOfThunder, (v) => v);
      const [alerts, air] = await Promise.all([
        nwsAlerts(ll[0], ll[1]),
        airQuality ? airQuality.hourly(ll[0], ll[1]).catch(() => null) : Promise.resolve(null),
      ]);
      const now = Date.now() - 3_600_000;
      const hours: WeatherHour[] = [...temp.keys()]
        .filter((ms) => ms >= now)
        .sort((a, b) => a - b)
        .map((ms) => ({
          time: localHour(ms, pt!.v.timeZone),
          tempF: temp.get(ms) ?? null,
          feelsF: feels.get(ms) ?? null,
          humidity: hum.get(ms) ?? null,
          wbgtF: wbgt.get(ms) ?? null,
          windMph: wind.get(ms) ?? null,
          precipPct: pop.get(ms) ?? null,
          thunderPct: thunder.get(ms) ?? null,
          aqi: air?.get(ms) ?? null,
        }));
      const v: Forecast = { zip, place: pt.v.place, timeZone: pt.v.timeZone, hours, alerts };
      fcCache.set(zip, { at: Date.now(), v });
      return v;
    } catch (err) {
      console.warn("weather unavailable for", zip, (err as Error).message);
      return null;
    }
  }
}

/** Active NWS alerts at a point. Never throws. */
async function nwsAlerts(lat: number, lon: number): Promise<WxAlert[]> {
  try {
    const j = await getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, 4000);
    return (j.features || []).map((f: any) => ({
      event: String(f.properties?.event || ""),
      severity: String(f.properties?.severity || ""),
      headline: String(f.properties?.headline || f.properties?.event || ""),
      ends: f.properties?.ends || f.properties?.expires || undefined,
    })).filter((a: WxAlert) => a.event);
  } catch {
    return [];
  }
}

/**
 * Air quality source. Open-Meteo (free, no key) by default. AirNow's ZIP and
 * lat/lon endpoints are being retired in fall 2026, so it is not the default;
 * another source can be plugged in by implementing this interface.
 * Set AIR_QUALITY=off to disable.
 */
export interface AirQualityProvider {
  /** US AQI keyed by UTC hour (ms). */
  hourly(lat: number, lon: number): Promise<Map<number, number> | null>;
}

export class OpenMeteoAir implements AirQualityProvider {
  async hourly(lat: number, lon: number): Promise<Map<number, number> | null> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi&timezone=GMT&forecast_days=5`,
        { signal: ctl.signal },
      );
      if (!res.ok) return null;
      const j: any = await res.json();
      const out = new Map<number, number>();
      (j.hourly?.time || []).forEach((tm: string, i: number) => {
        const v = j.hourly.us_aqi?.[i];
        if (typeof v === "number") out.set(Date.parse(tm + ":00Z"), v);
      });
      return out;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}

const airQuality: AirQualityProvider | null = process.env.AIR_QUALITY === "off" ? null : new OpenMeteoAir();

/** For tests and local dev without network. */
export class StaticProvider implements WeatherProvider {
  constructor(private readonly data: Record<string, Forecast>) {}
  async forecast(zip: string) { return this.data[zip] || null; }
}

/**
 * Local development only (WEATHER=demo): a fake 7-day forecast so heat and
 * cold screens can be tried any time of year. 07039 = heat wave,
 * 08540 = cold snap, anything else = mild. Never used in production.
 */
export class DemoProvider implements WeatherProvider {
  async forecast(zip: string): Promise<Forecast | null> {
    if (!zipToLatLon(zip)) return null;
    const hot = zip === "07039", cold = zip === "08540";
    const hours: WeatherHour[] = [];
    const start = new Date(); start.setMinutes(0, 0, 0);
    for (let i = 0; i < 168; i++) {
      const d = new Date(start.getTime() + i * 3_600_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const day = d.getHours() >= 10 && d.getHours() <= 19;
      hours.push({
        time: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`,
        tempF: hot ? (day ? 95 : 80) : cold ? (day ? 24 : 15) : 66,
        feelsF: hot ? (day ? 104 : 82) : cold ? (day ? 13 : 5) : 66,
        humidity: hot ? 55 : 60,
        wbgtF: hot ? (day ? 86.8 : 76) : cold ? 18 : 62,
        windMph: cold ? 14 : 5,
        precipPct: cold ? 30 : 5,
        thunderPct: hot && d.getHours() >= 16 && d.getHours() <= 19 ? 35 : 0,
        aqi: hot ? 115 : 35,
      });
    }
    return { zip, place: hot ? "Roseland, NJ (demo heat)" : cold ? "Princeton, NJ (demo cold)" : "Demo", timeZone: "America/New_York", hours };
  }
}
