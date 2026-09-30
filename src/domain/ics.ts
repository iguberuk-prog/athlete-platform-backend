/**
 * iCalendar (.ics) import for team schedules.
 *
 * TeamSnap, SportsEngine, PlayMetrics, GameChanger, LeagueApps, Heja, Spond,
 * Google Calendar and most league sites offer a "subscribe to calendar" link.
 * We read that feed, keep games, practices and tournaments, and turn each into
 * a scheduled event at the local time of the player's time zone, with the
 * field's ZIP code pulled from the address for the weather forecast.
 */

import type { ScheduledEvent } from "./profile.js";

export interface IcsEvent {
  uid: string;
  summary: string;
  location?: string;
  description?: string;
  startMs: number;
  /** All-day event (no time). */
  allDay: boolean;
  durationMin?: number;
  cancelled: boolean;
}

/** Undo RFC 5545 line folding and split into lines. */
function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();

/** Offset (minutes, east positive) of a zone at a UTC instant. */
export function zoneOffset(tz: string, ms: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch {
    return 0;
  }
}

/** Wall-clock time in `tz` -> UTC ms (handles DST by re-checking the offset). */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = zoneOffset(tz, guess);
  let t = guess - off * 60_000;
  const off2 = zoneOffset(tz, t);
  if (off2 !== off) { off = off2; t = guess - off * 60_000; }
  return t;
}

function parseDate(value: string, params: string, fallbackTz: string): { ms: number; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { ms: Date.UTC(+y, +mo - 1, +d, 12, 0), allDay: true };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi), allDay: false };
  const tzid = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2];
  return { ms: wallToUtc(+y, +mo, +d, +h, +mi, tzid || fallbackTz), allDay: false };
}

function parseDuration(v: string): number | undefined {
  const m = v.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return undefined;
  return (Number(m[1] || 0) * 7 + Number(m[2] || 0)) * 1440 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

/** Parse VEVENTs, expanding simple weekly repeats inside [fromMs, toMs]. */
export function parseIcs(text: string, tz: string, fromMs: number, toMs: number): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, { v: string; p: string }[]> | null = null;
  for (const raw of lines(text)) {
    if (raw === "BEGIN:VEVENT") { cur = {}; continue; }
    if (raw === "END:VEVENT") {
      if (cur) out.push(...toEvents(cur, tz, fromMs, toMs));
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const [name, ...ps] = head.split(";");
    (cur[name.toUpperCase()] ||= []).push({ v: raw.slice(i + 1), p: ps.join(";") });
    if (out.length > 5000) break;
  }
  return out;
}

function toEvents(c: Record<string, { v: string; p: string }[]>, tz: string, fromMs: number, toMs: number): IcsEvent[] {
  const g = (k: string) => c[k]?.[0];
  const ds = g("DTSTART");
  if (!ds) return [];
  const start = parseDate(ds.v.trim(), ds.p, tz);
  if (!start) return [];
  let durationMin: number | undefined;
  const de = g("DTEND");
  if (de) {
    const end = parseDate(de.v.trim(), de.p, tz);
    if (end && !start.allDay) durationMin = Math.round((end.ms - start.ms) / 60_000);
  } else if (g("DURATION")) durationMin = parseDuration(g("DURATION")!.v.trim());
  if (durationMin !== undefined && (durationMin <= 0 || durationMin > 720)) durationMin = undefined;
  const base: IcsEvent = {
    uid: (g("UID")?.v || `${ds.v}-${g("SUMMARY")?.v || ""}`).trim().slice(0, 200),
    summary: unescape(g("SUMMARY")?.v || "").slice(0, 200),
    location: g("LOCATION") ? unescape(g("LOCATION")!.v).slice(0, 200) : undefined,
    description: g("DESCRIPTION") ? unescape(g("DESCRIPTION")!.v).slice(0, 500) : undefined,
    startMs: start.ms,
    allDay: start.allDay,
    durationMin,
    cancelled: /CANCEL/i.test(g("STATUS")?.v || "") || /^cancel+ed\b|\bcancel+ed\b/i.test(g("SUMMARY")?.v || ""),
  };
  const rr = g("RRULE")?.v;
  const exdates = new Set((c.EXDATE || []).flatMap((e) => e.v.split(",").map((x) => parseDate(x.trim(), e.p, tz)?.ms)).filter(Boolean) as number[]);
  if (!rr) return base.startMs >= fromMs && base.startMs <= toMs ? [base] : [];
  const rule = Object.fromEntries(rr.split(";").map((kv) => kv.split("=")));
  if (rule.FREQ !== "WEEKLY" && rule.FREQ !== "DAILY") return base.startMs >= fromMs && base.startMs <= toMs ? [base] : [];
  const step = (rule.FREQ === "WEEKLY" ? 7 : 1) * Math.max(1, Number(rule.INTERVAL || 1));
  const count = rule.COUNT ? Number(rule.COUNT) : 200;
  const until = rule.UNTIL ? parseDate(rule.UNTIL, "", tz)?.ms ?? toMs : toMs;
  const res: IcsEvent[] = [];
  // Walk in local days so DST doesn't shift the wall-clock time.
  const off0 = zoneOffset(tz, base.startMs);
  const local0 = base.startMs + off0 * 60_000;
  for (let i = 0; i < count && i < 400; i++) {
    const local = local0 + i * step * 86_400_000;
    const d = new Date(local);
    const ms = start.allDay ? local : wallToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), tz);
    if (ms > until || ms > toMs) break;
    if (ms < fromMs || exdates.has(ms)) continue;
    res.push({ ...base, uid: `${base.uid}#${i}`, startMs: ms });
  }
  return res;
}

export type ImportType = ScheduledEvent["type"] | null;

/** Game, practice, tournament, or skip (team party, picture day, fundraiser). */
export function classify(summary: string, description = ""): ImportType {
  const s = `${summary} ${description.slice(0, 120)}`.toLowerCase();
  if (/tournament|showcase|\bcup\b|festival|jamboree|classic\b/.test(s)) return "tournament";
  if (/practice|training|session|clinic|skills|conditioning|scrimmage|tryout/.test(s)) return /scrimmage/.test(s) ? "match" : "training";
  if (/\bgame\b|match|\bvs\.?\b|\bv\.?\s|\bat\s|@|league|playoff|final|semi/.test(s)) return "match";
  if (/party|picture|photo|meeting|fundraiser|banquet|volunteer|parent/.test(s)) return null;
  return null;
}

/** Last 5-digit ZIP in an address, e.g. "Memorial Field, 50 Main St, Livingston, NJ 07039". */
export function zipFrom(location?: string): string | undefined {
  const m = (location || "").match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  return m?.[1];
}

/** Local "YYYY-MM-DDTHH:MM:00+HH:MM" in the player's zone. */
export function localIso(ms: number, tz: string, allDay: boolean): string {
  const off = zoneOffset(tz, ms);
  const d = new Date(ms + off * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  if (allDay) return date;
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${date}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/** Feed events -> scheduled events for one feed. */
export function toScheduled(evs: IcsEvent[], feedId: string, tz: string, defaultZip?: string): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const e of evs) {
    if (e.cancelled) continue;
    const type = classify(e.summary, e.description);
    if (!type) continue;
    out.push({
      type,
      uid: e.uid,
      source: feedId,
      title: e.summary || undefined,
      location: e.location,
      startTime: localIso(e.startMs, tz, e.allDay),
      durationMin: e.durationMin,
      zip: zipFrom(e.location) || defaultZip,
      importance: type === "match" || type === "tournament" ? "high" : "normal",
    });
  }
  return out;
}
