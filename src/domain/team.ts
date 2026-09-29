/**
 * Teams: how a coach sees their players.
 *
 * A coach creates a team and gets a short join code. A player (or the parent
 * who manages the player) enters that code on the profile to join. Joining is
 * the player's consent to share a limited roster view with that coach:
 * name, photo, position, readiness from check-ins, next game, and the food
 * safety facts (allergies, diet) a coach needs for team meals. Contact
 * details, medical notes and full check-in history stay private.
 */

import { randomInt } from "node:crypto";
import type { Readiness } from "./readiness.js";

export interface Team {
  id: string;
  name: string;
  /** Join code players enter, e.g. K7F2QM. */
  code: string;
  coachOwnerId: string;
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  profileId: string;
  /** Account that owns the member's profile. */
  ownerId: string;
  joinedAt: string;
}

export interface RosterEntry {
  profileId: string;
  name: string;
  avatarUrl?: string;
  playerCode?: string;
  positions: string[];
  jerseyNumber?: number;
  readiness: Readiness | null;
  lastCheckinDate: string | null;
  soreness: number | null;
  sleepHours: number | null;
  nextMatch: { date: string; time: string } | null;
  allergies: string[];
  diets: string[];
  injuryFlag: boolean;
  joinedAt: string;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newJoinCode(n = 6): string {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export function normalizeCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
