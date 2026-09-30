/**
 * Club layer (pure types and helpers).
 *
 * A club has staff with roles and owns teams:
 *   director   runs the club: staff, teams, branding, fields, billing, sponsors, camps
 *   coach      their own teams
 *   trainer    athletic trainer / medical staff: sees medical details across the
 *              club (allergies, conditions, asthma, concussion steps) that
 *              coaches don't, and can record return-to-play clearance
 *   parent     (existing) through family links and team membership
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { effectiveAge } from "./profile.js";
import { addDays, daysBetween } from "./dates.js";
import { activeConcussion, loadGuard } from "./health.js";
import { riskScore } from "./risk.js";

export const STAFF_ROLES = ["director", "coach", "trainer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const CERT_TYPES = ["safesport", "cpr_first_aid", "concussion_training", "background_check", "coaching_license", "athletic_trainer_license"] as const;
export type CertType = (typeof CERT_TYPES)[number];
export const CERT_LABEL: Record<CertType, string> = {
  safesport: "SafeSport training", cpr_first_aid: "CPR / First Aid / AED", concussion_training: "Concussion training (CDC HEADS UP)",
  background_check: "Background check", coaching_license: "Coaching license", athletic_trainer_license: "Athletic trainer license",
};
/** Typical renewal periods, used when no expiry date is entered. */
export const CERT_YEARS: Record<CertType, number> = { safesport: 1, cpr_first_aid: 2, concussion_training: 1, background_check: 2, coaching_license: 5, athletic_trainer_license: 2 };
export const REQUIRED_CERTS: Record<StaffRole, CertType[]> = {
  director: ["safesport", "background_check"],
  coach: ["safesport", "background_check", "concussion_training", "cpr_first_aid"],
  trainer: ["safesport", "background_check", "athletic_trainer_license", "cpr_first_aid"],
};

export interface Cert { type: CertType; completed: string; expires?: string; note?: string }
export interface OnCall { active: boolean; location?: string; until?: string }

export interface Club {
  id: string;
  name: string;
  directorId: string;
  logoUrl?: string;
  primary?: string;
  accent?: string;
  sponsor?: { name: string; url?: string; message?: string; logoUrl?: string };
  plan: "trial" | "active" | "past_due" | "canceled" | "free";
  trialEnds?: string;
  seats?: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  referralCode: string;
  referredBy?: string;
  freeMonths?: number;
  fields?: Field[];
  createdAt: string;
}

export interface Field { id: string; name: string; zip: string; status: "open" | "closed" | "delayed"; note?: string; updatedAt?: string }

export interface Staff { clubId: string; userId: string; role: StaffRole; email?: string; name?: string; phone?: string; certs: Cert[]; onCall?: OnCall; teamIds?: string[] }

export const isHex = (v: unknown) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

export function certStatus(c: Cert, today: string): { expires: string; status: "ok" | "expiring" | "expired" } {
  const expires = c.expires || addDays(c.completed, Math.round(CERT_YEARS[c.type] * 365));
  const left = daysBetween(today, expires);
  return { expires, status: left < 0 ? "expired" : left <= 30 ? "expiring" : "ok" };
}

/** What's missing, expiring or expired for one staff member. */
export function certReport(s: Staff, today: string): { missing: CertType[]; expiring: { type: CertType; expires: string }[]; expired: { type: CertType; expires: string }[] } {
  const latest = new Map<CertType, Cert>();
  for (const c of s.certs || []) { const cur = latest.get(c.type); if (!cur || c.completed > cur.completed) latest.set(c.type, c); }
  const out = { missing: [] as CertType[], expiring: [] as { type: CertType; expires: string }[], expired: [] as { type: CertType; expires: string }[] };
  for (const t of REQUIRED_CERTS[s.role]) {
    const c = latest.get(t);
    if (!c) { out.missing.push(t); continue; }
    const st = certStatus(c, today);
    if (st.status === "expired") out.expired.push({ type: t, expires: st.expires });
    else if (st.status === "expiring") out.expiring.push({ type: t, expires: st.expires });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rosters for club staff
// ---------------------------------------------------------------------------

export interface MedicalRow {
  profileId: string;
  name: string;
  team: string;
  age: number | null;
  jersey?: number;
  allergies: string[];
  epinephrine: boolean;
  asthma: boolean;
  medicalDiets: string[];
  emergency?: { name?: string; phone: string };
  /** Trainer only below this line. */
  conditions?: string[];
  medications?: string[];
  concussion?: { date: string; step: number; clearedAt?: string } | null;
  injuries?: string[];
}

const ALLERGEN: Record<string, string> = { peanut: "peanut", tree_nut: "tree nut", milk: "milk", egg: "egg", wheat: "wheat", gluten: "gluten", soy: "soy", fish: "fish", shellfish: "shellfish", sesame: "sesame" };

/** Directors get the safety view; trainers also get medical details. */
export function medicalRow(p: AthleteProfile, team: string, role: StaffRole): MedicalRow {
  const al = p.nutrition.allergies || [];
  const row: MedicalRow = {
    profileId: p.id, name: p.identity.fullName, team, age: effectiveAge(p.identity) ?? null, jersey: p.identity.jerseyNumber,
    allergies: al.map((a) => (a.allergen === "other" ? a.note || "other" : ALLERGEN[a.allergen] || a.allergen) + (a.severity === "severe" || a.anaphylaxis ? " (severe)" : "")),
    epinephrine: al.some((a) => a.epinephrine),
    asthma: !!p.health?.asthma?.has,
    medicalDiets: (p.nutrition.medicalDiets || []).filter((m) => m === "celiac" || m === "type1_diabetes"),
    emergency: p.contact?.emergencyContact?.phone ? { name: p.contact.emergencyContact.name, phone: p.contact.emergencyContact.phone } : p.contact?.parentPhone ? { name: "Parent", phone: p.contact.parentPhone } : undefined,
  };
  const c = activeConcussion(p) || (p.health?.concussions || []).slice(-1)[0];
  if (role === "trainer") {
    row.conditions = p.health?.medicalConditions || [];
    row.medications = p.health?.medications || [];
    row.injuries = (p.health?.currentInjuries || []).map((i) => i.description);
    row.medicalDiets = p.nutrition.medicalDiets || [];
    row.concussion = c ? { date: c.date, step: c.step, clearedAt: c.clearedAt } : null;
  } else {
    // Directors see only whether a player is cleared, not the details.
    row.concussion = activeConcussion(p) ? { date: activeConcussion(p)!.date, step: activeConcussion(p)!.step } : null;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Club dashboard
// ---------------------------------------------------------------------------

export interface TeamHealth {
  teamId: string;
  name: string;
  players: number;
  checkinRate7d: number;
  overloaded: number;
  highRisk: number;
  notCleared: number;
}

export function teamHealth(teamId: string, name: string, roster: { p: AthleteProfile; checkins: DailyCheckIn[] }[], today: string): TeamHealth {
  const from = addDays(today, -6);
  let slots = 0, done = 0, overloaded = 0, highRisk = 0, notCleared = 0;
  for (const { p, checkins } of roster) {
    slots += 7;
    done += new Set(checkins.filter((c) => c.date >= from && c.date <= today).map((c) => c.date)).size;
    const age = effectiveAge(p.identity);
    if (age !== undefined && age < 19) {
      const lg = loadGuard(p, today);
      if ((lg.maxHours !== null && lg.weekHours > lg.maxHours) || lg.restDays < 1) overloaded++;
    }
    if (riskScore(p, checkins, today).level === "high") highRisk++;
    if (activeConcussion(p)) notCleared++;
  }
  return { teamId, name, players: roster.length, checkinRate7d: slots ? Math.round((done / slots) * 100) : 0, overloaded, highRisk, notCleared };
}

// ---------------------------------------------------------------------------
// Team challenges
// ---------------------------------------------------------------------------

export const CHALLENGE_TYPES = ["checkin", "hydration", "sleep", "warmup"] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];
export const CHALLENGE_LABEL: Record<ChallengeType, string> = { checkin: "Check-in streak", hydration: "Hydration week", sleep: "Sleep challenge", warmup: "Warm-up challenge" };

export interface Challenge { id: string; teamId: string; type: ChallengeType; title: string; start: string; end: string; winners?: string[]; announcement?: string; createdAt: string }

export function challengeBoard(ch: Challenge, roster: { name: string; p: AthleteProfile; checkins: DailyCheckIn[] }[], sleepTarget: (p: AthleteProfile) => number) {
  const days = daysBetween(ch.start, ch.end) + 1;
  const rows = roster.map(({ name, p, checkins }) => {
    const inRange = checkins.filter((c) => c.date >= ch.start && c.date <= ch.end);
    const score = ch.type === "checkin" ? new Set(inRange.map((c) => c.date)).size
      : ch.type === "hydration" ? inRange.filter((c) => (c.urineColor !== undefined ? c.urineColor <= 3 : (c.hydrationLevel ?? 0) >= 7)).length
      : ch.type === "sleep" ? inRange.filter((c) => (c.sleepHoursLastNight ?? 0) >= sleepTarget(p)).length
      : inRange.filter((c) => c.warmupDone).length;
    return { name: firstAndInitial(name), score };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const teamPct = roster.length ? Math.round((rows.reduce((a, r) => a + r.score, 0) / (roster.length * days)) * 100) : 0;
  return { days, rows, teamPct };
}

export const firstAndInitial = (full: string) => { const p = (full || "").trim().split(/\s+/); return `${p[0] || ""}${p[1] ? " " + p[1][0] + "." : ""}`; };

// ---------------------------------------------------------------------------
// Camps and clinics
// ---------------------------------------------------------------------------

export interface Camp { id: string; clubId?: string; title: string; org: string; url?: string; start: string; end?: string; zip: string; ageMin: number; ageMax: number; positions?: string[]; price?: number; description?: string }

/** Miles between two lat/lon points. */
export function miles(a: [number, number], b: [number, number]): number {
  const R = 3958.8, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function matchCamps(p: AthleteProfile, camps: Camp[], today: string, geo: (zip: string) => [number, number] | null, radius = 60) {
  const age = effectiveAge(p.identity);
  const pos = (p.sport.positions || [])[0];
  const home = p.routine?.homeZip ? geo(p.routine.homeZip) : null;
  return camps
    .filter((c) => (c.end || c.start) >= today && (age === undefined || (age >= c.ageMin && age <= c.ageMax)))
    .map((c) => { const g = geo(c.zip); return { ...c, distance: home && g ? miles(home, g) : null, positionMatch: !c.positions?.length || (!!pos && c.positions.includes(pos)) }; })
    .filter((c) => c.distance === null || c.distance <= radius)
    .sort((a, b) => Number(b.positionMatch) - Number(a.positionMatch) || a.start.localeCompare(b.start));
}
