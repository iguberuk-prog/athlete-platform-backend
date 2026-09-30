/**
 * Weekly parent report (pure). Last 7 days plus the week ahead, in plain
 * words. Shown on screen and emailed on Sunday evening. Never includes body
 * weight, and keeps sensitive items (cycle, mood details) out of email.
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { addDays, eventDate, eventTime, routineOf, shortDate, sortedEvents, to12 } from "./dates.js";
import { buildHealthStatus } from "./health.js";
import { REGION_LABEL } from "./health.js";
import { sleepHoursFor } from "./ageBands.js";
import { effectiveAge } from "./profile.js";

export interface WeeklyReport {
  profileId: string;
  firstName: string;
  weekOf: string;
  lastWeek: { checkins: number; avgSleep: number | null; sleepTarget: [number, number]; avgEnergy: number | null; highStressDays: number; sessions: number; hours: number; soreSpots: string[] };
  alerts: { title: string; detail: string; level: string }[];
  nextWeek: { date: string; label: string; time: string; type: string; title?: string }[];
  highlights: string[];
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function buildWeeklyReport(profile: AthleteProfile, checkins: DailyCheckIn[], today: string): WeeklyReport {
  const from = addDays(today, -6);
  const week = checkins.filter((c) => c.date >= from && c.date <= today);
  const r = routineOf(profile);
  const past = sortedEvents(profile).filter((e) => (e.type === "match" || e.type === "training") && eventDate(e) >= from && eventDate(e) <= today);
  const mins = past.reduce((a, e) => a + (e.durationMin || (e.type === "match" ? 110 : profile.training?.avgSessionMinutes || 90)), 0);
  const sore = new Map<string, number>();
  for (const c of week) for (const s of c.soreSpots || []) if (s.level >= 4) sore.set(REGION_LABEL[s.region], (sore.get(REGION_LABEL[s.region]) || 0) + 1);
  const status = buildHealthStatus(profile, checkins, today, { viewer: "parent" });
  const avgSleep = avg(week.map((c) => c.sleepHoursLastNight).filter((x): x is number => typeof x === "number"));
  const target = sleepHoursFor(effectiveAge(profile.identity));
  const highlights: string[] = [];
  if (week.length >= 5) highlights.push(`Checked in ${week.length} of 7 days. Great habit.`);
  else if (week.length <= 2) highlights.push("Only a few check-ins this week. Daily check-ins make the plans much better.");
  if (avgSleep !== null) highlights.push(avgSleep >= target[0] ? `Sleep averaged ${avgSleep} h, on target.` : `Sleep averaged ${avgSleep} h. Target is ${target[0]}-${target[1]} h.`);
  const warm = week.filter((c) => c.warmupDone).length;
  if (warm) highlights.push(`Did the injury-prevention warm-up ${warm} time${warm === 1 ? "" : "s"}.`);
  const next = sortedEvents(profile).filter((e) => eventDate(e) > today && eventDate(e) <= addDays(today, 7)).slice(0, 12);
  return {
    profileId: profile.id,
    firstName: (profile.identity.fullName || "").split(/\s+/)[0],
    weekOf: from,
    lastWeek: {
      checkins: week.length, avgSleep, sleepTarget: target,
      avgEnergy: avg(week.map((c) => c.energyLevel).filter((x): x is number => typeof x === "number")),
      highStressDays: week.filter((c) => (c.stressLevel ?? 0) >= 7).length,
      sessions: past.length, hours: Math.round((mins / 60) * 10) / 10,
      soreSpots: [...sore.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n} day${n === 1 ? "" : "s"})`).slice(0, 4),
    },
    // Cycle alerts stay in the app, not in email.
    alerts: status.alerts.filter((a) => !a.id.startsWith("cycle")).map((a) => ({ title: a.title, detail: a.detail, level: a.level })),
    nextWeek: next.map((e) => ({ date: eventDate(e), label: shortDate(eventDate(e)), time: to12(eventTime(e, r.practice)), type: e.type, title: e.title })),
    highlights,
  };
}

const TYPE: Record<string, string> = { match: "Game", training: "Practice", recovery: "Recovery", travel: "Travel", tournament: "Tournament" };

export function reportEmail(rep: WeeklyReport, appUrl: string, brand = "Athlete Performance"): { subject: string; text: string; html: string } {
  const e = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const L = rep.lastWeek;
  const lines = [
    `${rep.firstName}'s week`,
    ...rep.highlights,
    `Sessions: ${L.sessions} (${L.hours} hours).`,
    L.soreSpots.length ? `Sore spots: ${L.soreSpots.join(", ")}.` : "",
  ].filter(Boolean);
  const alerts = rep.alerts.map((a) => `${a.title}: ${a.detail}`);
  const next = rep.nextWeek.map((n) => `${n.label} ${n.time}: ${n.title || TYPE[n.type] || n.type}`);
  const text = [
    lines.join("\n"),
    alerts.length ? `Worth a look\n${alerts.join("\n")}` : "",
    next.length ? `Coming up\n${next.join("\n")}` : "Nothing on the schedule next week.",
    `Open the app: ${appUrl}`,
    "You get this because you're linked as a parent. Turn it off in the app under Settings.",
  ].filter(Boolean).join("\n\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#111">
<h2 style="margin:0 0 8px">${e(rep.firstName)}'s week</h2>
${lines.slice(1).map((l) => `<p style="margin:6px 0">${e(l)}</p>`).join("")}
${alerts.length ? `<h3 style="margin:18px 0 6px">Worth a look</h3>${rep.alerts.map((a) => `<p style="margin:6px 0"><b>${e(a.title)}.</b> ${e(a.detail)}</p>`).join("")}` : ""}
<h3 style="margin:18px 0 6px">Coming up</h3>
${next.length ? `<ul style="padding-left:18px">${next.map((n) => `<li>${e(n)}</li>`).join("")}</ul>` : "<p>Nothing on the schedule next week.</p>"}
<p style="margin:18px 0"><a href="${e(appUrl)}" style="background:#0a7d4f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open ${e(brand)}</a></p>
<p style="color:#666;font-size:12px">You get this because you're linked as a parent. Turn it off in the app under Settings.</p></div>`;
  return { subject: `${rep.firstName}'s week in ${brand}`, text, html };
}
