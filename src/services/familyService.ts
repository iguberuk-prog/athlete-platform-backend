/**
 * Family links: share one player's profile between a parent account and the
 * player's own account.
 *
 *   - A teen who owns their profile creates a family code in Settings and
 *     gives it to a parent. Creating the code is the teen's consent.
 *   - A parent who set up a young child's profile can create a code so the
 *     child (once old enough) signs in on their own phone.
 *   - Either side can remove the link at any time.
 *
 * A linked account can view the profile, plans and health screens and log
 * check-ins. Only the owner can edit or delete the profile.
 */

import { randomInt, randomUUID } from "node:crypto";
import type { AthleteProfileRepository, AppRecord, RecordRepository } from "../data/repository.js";
import type { AthleteProfile } from "../domain/profile.js";

export interface LinkData {
  profileId: string;
  profileOwnerId: string;
  /** What the linked account is to the player. */
  role: "parent" | "athlete";
  email?: string;
  name?: string;
}

interface InviteData {
  profileId: string;
  role: "parent" | "athlete";
  expiresAt: string;
}

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 8 }, () => ALPHA[randomInt(ALPHA.length)]).join("");

export type FamilyResult<T> = { ok: true; value: T } | { ok: false; code: "not_found" | "invalid" | "forbidden"; message?: string };

export class FamilyService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly records: RecordRepository,
  ) {}

  /** The owner id to use for a profile, if this user may see it (owner or linked). */
  async ownerFor(userId: string, profileId: string): Promise<string | null> {
    if (await this.profiles.getById(userId, profileId)) return userId;
    const link = await this.records.get<LinkData>("link", `${profileId}:${userId}`);
    return link ? link.data.profileOwnerId : null;
  }

  async createInvite(ownerId: string, profileId: string, role: "parent" | "athlete"): Promise<FamilyResult<{ code: string; expiresAt: string }>> {
    const p = await this.profiles.getById(ownerId, profileId);
    if (!p) return { ok: false, code: "not_found" };
    if (role !== "parent" && role !== "athlete") return { ok: false, code: "invalid", message: "Pick parent or player." };
    // One open code per profile: replace any older one.
    for (const old of await this.records.listByKey<InviteData>("invite", profileId)) await this.records.delete("invite", old.id);
    const code = newCode();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await this.records.put<InviteData>({ id: code, kind: "invite", key: profileId, ownerId, data: { profileId, role, expiresAt } });
    return { ok: true, value: { code, expiresAt } };
  }

  async redeem(userId: string, email: string | undefined, rawCode: string): Promise<FamilyResult<{ profileId: string; name: string }>> {
    const code = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const inv = code.length === 8 ? await this.records.get<InviteData>("invite", code) : null;
    if (!inv || inv.data.expiresAt < new Date().toISOString()) return { ok: false, code: "invalid", message: "That family code is wrong or expired. Ask for a new one." };
    if (inv.ownerId === userId) return { ok: false, code: "invalid", message: "That's your own code. Give it to your parent or player to enter on their account." };
    const p = await this.profiles.getById(inv.ownerId, inv.data.profileId);
    if (!p) return { ok: false, code: "not_found" };
    await this.records.put<LinkData>({
      id: `${p.id}:${userId}`, kind: "link", key: p.id, ownerId: userId,
      data: { profileId: p.id, profileOwnerId: inv.ownerId, role: inv.data.role, email },
    });
    await this.records.delete("invite", code);
    return { ok: true, value: { profileId: p.id, name: p.identity.fullName } };
  }

  /** Profiles shared with this user (not owned by them). */
  async linkedProfiles(userId: string): Promise<(AthleteProfile & { linkRole: string })[]> {
    const links = await this.records.listByOwner<LinkData>("link", userId);
    const out: (AthleteProfile & { linkRole: string })[] = [];
    for (const l of links) {
      const p = await this.profiles.getById(l.data.profileOwnerId, l.data.profileId);
      if (p) out.push({ ...p, linkRole: l.data.role });
      else await this.records.delete("link", l.id);
    }
    return out;
  }

  /** Who else can see this profile (for the owner or a linked account). */
  async links(userId: string, profileId: string): Promise<FamilyResult<{ userId: string; role: string; email?: string; since: string; self: boolean }[]>> {
    if (!(await this.ownerFor(userId, profileId))) return { ok: false, code: "not_found" };
    const list = await this.records.listByKey<LinkData>("link", profileId);
    return { ok: true, value: list.map((l: AppRecord<LinkData>) => ({ userId: l.ownerId, role: l.data.role, email: l.data.email, since: l.createdAt, self: l.ownerId === userId })) };
  }

  /** The owner removes anyone; a linked account removes itself. */
  async unlink(userId: string, profileId: string, targetUserId: string): Promise<FamilyResult<true>> {
    const isOwner = !!(await this.profiles.getById(userId, profileId));
    if (!isOwner && targetUserId !== userId) return { ok: false, code: "forbidden" };
    const removed = await this.records.delete("link", `${profileId}:${targetUserId}`);
    return removed ? { ok: true, value: true } : { ok: false, code: "not_found" };
  }

  /** Emails of parents to notify about this profile (linked parents + parent email on file). */
  async parentEmails(profile: AthleteProfile): Promise<string[]> {
    const links = await this.records.listByKey<LinkData>("link", profile.id);
    const out = new Set<string>();
    for (const l of links) if (l.data.role === "parent" && l.data.email) out.add(l.data.email.toLowerCase());
    if (profile.contact?.parentEmail) out.add(profile.contact.parentEmail.toLowerCase());
    return [...out];
  }

  static id = () => randomUUID();
}
