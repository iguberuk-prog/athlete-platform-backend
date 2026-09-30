/**
 * Team apps we connect to, and how.
 *
 *   "signin"   Sign in with that app (OAuth). We read the teams and schedule.
 *              TeamSnap and Google Calendar today.
 *   "link"     The app gives every parent a calendar subscribe link (iCal/webcal).
 *              The player pastes it once and it syncs every day.
 *   "phone"    The app only pushes events into the phone's calendar (Spond, BAND).
 *              Families connect Google Calendar instead and pick that calendar.
 *
 * We never ask for another app's password. Sign-in happens on that app's own page.
 */

import type { ScheduledEvent } from "./profile.js";
import { classify, localIso, zipFrom } from "./ics.js";

export type ConnectKind = "signin" | "link" | "phone";

export interface TeamApp {
  id: string;
  name: string;
  kind: ConnectKind;
  /** Where the subscribe link lives, in that app's words. */
  steps: string[];
  /** Hostnames seen in that app's calendar links, for auto-detect. */
  hosts?: string[];
  popular?: boolean;
  note?: string;
}

export const TEAM_APPS: TeamApp[] = [
  { id: "teamsnap", name: "TeamSnap", kind: "signin", popular: true, hosts: ["teamsnap.com"],
    steps: ["Tap Sign in with TeamSnap.", "Log in on TeamSnap's page and allow access.", "Pick the teams to bring in."],
    note: "No sign-in yet? In TeamSnap: Schedule, then Settings (gear), then Sync Calendar. Copy the link and paste it here." },
  { id: "google", name: "Google Calendar", kind: "signin", popular: true, hosts: ["calendar.google.com", "google.com"],
    steps: ["Tap Sign in with Google.", "Allow read-only calendar access.", "Pick the calendar that has the games."],
    note: "Works for any app that already sends games to your Google Calendar, like Spond or BAND." },
  { id: "sportsengine", name: "SportsEngine", kind: "link", popular: true, hosts: ["sportngin.com", "sportsengine.com", "ngin.com"],
    steps: ["Open SportsEngine and go to Schedule.", "Tap Sync Schedule, then Other Calendar.", "Tap Copy and paste the link here."] },
  { id: "playmetrics", name: "PlayMetrics", kind: "link", popular: true, hosts: ["playmetrics.com"],
    steps: ["Open PlayMetrics and go to Calendar.", "Tap Sync Calendar and pick the player.", "Choose all events or games only, then copy the link."] },
  { id: "gamechanger", name: "GameChanger", kind: "link", popular: true, hosts: ["gc.com", "gamechanger.io"],
    steps: ["Open the team in GameChanger.", "Tap the gear icon, then Schedule Sync.", "Copy the calendar link."] },
  { id: "leagueapps", name: "LeagueApps", kind: "link", popular: true, hosts: ["leagueapps.com", "leagueapps.io"],
    steps: ["Open LeagueApps Play or the club site and go to Schedule.", "Tap Subscribe to Calendar.", "Tap Copy Link."] },
  { id: "gotsport", name: "GotSport", kind: "link", popular: true, hosts: ["gotsport.com", "gotsoccer.com"],
    steps: ["Open the team page in GotSport (app or web).", "Find the team iCal / calendar link.", "Copy it."] },
  { id: "sportsconnect", name: "Sports Connect (Stack Sports)", kind: "link", hosts: ["sportsconnect.com", "stacksports.com", "bluesombrero.com"],
    steps: ["On the club site go to Schedules, then Calendar.", "Tap Sync.", "Copy the calendar link."] },
  { id: "teamlinkt", name: "TeamLinkt", kind: "link", hosts: ["teamlinkt.com"],
    steps: ["Open the Events tab.", "Tap the three dots, then Subscribe.", "Copy the link."] },
  { id: "crossbar", name: "Crossbar", kind: "link", hosts: ["crossbar.org"],
    steps: ["Open Crossbar and find Family Calendar.", "Tap the calendar feed button.", "Copy the link."] },
  { id: "sportsyou", name: "sportsYou", kind: "link", hosts: ["sportsyou.com"],
    steps: ["Open the Calendar tab.", "Tap the subscribe icon.", "Copy the link."] },
  { id: "teamsideline", name: "TeamSideline", kind: "link", hosts: ["teamsideline.com"],
    steps: ["Open the team schedule.", "Tap the ! (exclamation) icon for calendar options.", "Copy the subscribe link."] },
  { id: "mojo", name: "MOJO", kind: "link", hosts: ["mojo.sport"],
    steps: ["Open the Schedule tab.", "Tap the blue calendar icon.", "Copy the link."] },
  { id: "heja", name: "Heja", kind: "link", hosts: ["heja.io"],
    steps: ["Open Schedule.", "Tap the icon in the top right, then Subscribe to team schedule.", "Copy the link."], note: "Needs Heja Plus." },
  { id: "jerseywatch", name: "Jersey Watch", kind: "link", hosts: ["jerseywatch.com"],
    steps: ["Open the league website.", "Find Calendar Sync.", "Copy the link."] },
  { id: "demosphere", name: "Demosphere", kind: "link", hosts: ["demosphere.com", "demosphere-secure.com"],
    steps: ["Open the team or club schedule page.", "Look for Subscribe or iCal.", "Copy the link."] },
  { id: "sprocket", name: "Sprocket Sports", kind: "link", hosts: ["sprocketsports.me", "sprocketsports.com"],
    steps: ["Open the schedule.", "Choose the iCal feed.", "Copy the link."] },
  { id: "playerfirst", name: "PlayerFirst", kind: "link", hosts: ["playerfirst.com"],
    steps: ["Open the club app Schedule tab.", "Tap the calendar icon.", "Copy the link."] },
  { id: "benchapp", name: "BenchApp", kind: "link", hosts: ["benchapp.com"],
    steps: ["Open the Schedule page.", "Tap Subscribe to Calendar.", "Copy the link."] },
  { id: "byga", name: "Byga", kind: "link", hosts: ["byga.net"],
    steps: ["On the website open My Calendar.", "Tap Subscribe / Export.", "Copy the link."] },
  { id: "rschooltoday", name: "rSchoolToday (school sports)", kind: "link", hosts: ["rschooltoday.com"],
    steps: ["Open the school's athletic calendar.", "Tap Subscribe.", "Copy the link."] },
  { id: "arbiter", name: "ArbiterLive (school sports)", kind: "link", hosts: ["arbiterlive.com", "arbitersports.com"],
    steps: ["Request a calendar feed on the team page.", "The link arrives by email.", "Paste it here."] },
  { id: "spond", name: "Spond", kind: "phone",
    steps: ["In Spond, turn on calendar sync to your Google Calendar.", "Then come back and tap Sign in with Google.", "Pick that calendar."] },
  { id: "band", name: "BAND", kind: "phone",
    steps: ["In BAND, export the schedule to your Google Calendar.", "Then tap Sign in with Google here.", "Pick that calendar."] },
  { id: "ical", name: "Any other calendar link", kind: "link",
    steps: ["In your team app look for Subscribe, Sync calendar, iCal or Export calendar.", "Copy the link (starts with webcal:// or https://).", "Paste it here."] },
];

/** Which app a pasted calendar link came from. */
export function detectApp(url: string): TeamApp | undefined {
  let host = "";
  try { host = new URL(String(url).trim().replace(/^webcal:/i, "https:")).hostname.toLowerCase(); } catch { return undefined; }
  return TEAM_APPS.find((a) => (a.hosts || []).some((h) => host === h || host.endsWith("." + h)));
}

// ---------------------------------------------------------------------------
// TeamSnap (API v3, Collection+JSON)
// ---------------------------------------------------------------------------

export type CjItem = { data: { name: string; value: unknown }[] };
export const cj = (item: CjItem): Record<string, any> => Object.fromEntries((item.data || []).map((d) => [d.name, d.value]));

export function teamsnapToScheduled(items: Record<string, any>[], feedId: string, tz: string, fromMs: number, toMs: number, defaultZip?: string): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const e of items) {
    if (e.is_canceled) continue;
    const ms = Date.parse(e.start_date || "");
    if (!Number.isFinite(ms) || ms < fromMs || ms > toMs) continue;
    const title = String(e.formatted_title || e.name || (e.is_game ? `Game${e.opponent_name ? " vs " + e.opponent_name : ""}` : "Practice")).slice(0, 120);
    const type = e.is_game ? (classify(title, String(e.notes || "")) === "tournament" ? "tournament" : "match") : classify(title, String(e.notes || "")) || "training";
    const location = [e.location_name, e.additional_location_details].filter(Boolean).join(", ") || undefined;
    out.push({
      type, uid: `ts-${e.id}`, source: feedId, title, location,
      startTime: localIso(ms, tz, false),
      durationMin: Number(e.duration_in_minutes) || undefined,
      zip: zipFrom(location) || defaultZip,
      importance: type === "match" || type === "tournament" ? "high" : "normal",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google Calendar (v3)
// ---------------------------------------------------------------------------

/**
 * Keep only sports events. With keywords (e.g. "soccer, Lions U14"), any event
 * mentioning one counts (as practice unless it reads like a game); without,
 * only events that clearly read as a game, practice or tournament.
 */
export function googleToScheduled(items: Record<string, any>[], feedId: string, tz: string, keywords: string[], defaultZip?: string): ScheduledEvent[] {
  const kw = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const out: ScheduledEvent[] = [];
  for (const e of items) {
    if (e.status === "cancelled") continue;
    const title = String(e.summary || "").slice(0, 120);
    const desc = String(e.description || "");
    const hay = `${title} ${desc.slice(0, 200)} ${e.location || ""}`.toLowerCase();
    const hit = kw.length ? kw.some((k) => hay.includes(k)) : true;
    if (!hit) continue;
    const t = classify(title, desc) || (kw.length ? "training" : null);
    if (!t) continue;
    const allDay = !e.start?.dateTime;
    const ms = Date.parse(e.start?.dateTime || `${e.start?.date}T12:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    const endMs = Date.parse(e.end?.dateTime || "");
    out.push({
      type: t, uid: `g-${e.id}`, source: feedId, title, location: e.location || undefined,
      startTime: localIso(ms, tz, allDay),
      durationMin: Number.isFinite(endMs) && !allDay ? Math.max(0, Math.round((endMs - ms) / 60000)) || undefined : undefined,
      zip: zipFrom(e.location) || defaultZip,
      importance: t === "match" || t === "tournament" ? "high" : "normal",
    });
  }
  return out;
}
