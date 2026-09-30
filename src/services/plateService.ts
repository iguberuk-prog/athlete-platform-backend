/**
 * Snap-a-plate: a photo of a meal -> what's on it, rough portions, and how it
 * fits today's plan. Uses Claude's vision through the Anthropic API.
 *
 * Safety: the photo can't prove a dish is allergen-free (hidden ingredients,
 * sauces, cross-contact), so any possible allergen match is flagged and the
 * result always says to check. Age 13+ only (features.ts). Photos are not
 * stored. 10 photos per account per day.
 *
 * Env: ANTHROPIC_API_KEY, optional ANTHROPIC_MODEL.
 */

import type { AthleteProfileRepository, RecordRepository } from "../data/repository.js";
import { featuresFor } from "../domain/features.js";
import { safetyContext, unsafeReason } from "../domain/foods.js";
import { classifyDay } from "../domain/daily.js";
import type { FamilyService } from "./familyService.js";

export interface PlateItem { name: string; portion: string; group: string; possibleAllergens: string[] }
export interface PlateResult {
  items: PlateItem[];
  estimates: { carbsG: number | null; proteinG: number | null; kcal: number | null };
  flags: string[];
  fit: string[];
  disclaimer: string;
}

const PROMPT = `You are a sports nutrition assistant for a youth and adult soccer app.
Look at the meal photo. Reply with ONLY a JSON object, no other text:
{"items":[{"name":"short food name","portion":"e.g. 1 cup, palm-size, 2 slices","group":"starch|protein|fruit|veg|dairy|fat|sweet|drink|other","possibleAllergens":["milk","egg","peanut","tree_nut","wheat","gluten","soy","fish","shellfish","sesame"]}],
"carbsG":number,"proteinG":number,"kcal":number,"confidence":"low|medium|high"}
List only allergens that could plausibly be in each item, including common hidden ones (butter, breading, sauces). If the image is not food, return {"items":[]}.`;

export type PlateResponse = { ok: true; value: PlateResult } | { ok: false; code: "not_found" | "invalid" | "age" | "limit" | "not_configured" | "failed"; message?: string };

export class PlateService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly http: typeof fetch = fetch,
  ) {}

  async analyze(userId: string, profileId: string, dataUrl: string, today: string): Promise<PlateResponse> {
    const owner = await this.family.ownerFor(userId, profileId);
    if (!owner) return { ok: false, code: "not_found" };
    const p = await this.profiles.getById(owner, profileId);
    if (!p) return { ok: false, code: "not_found" };
    const f = featuresFor(p);
    if (!f.on.snapPlate) return { ok: false, code: "age", message: f.off.snapPlate };
    const m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m || m[2].length > 5_000_000) return { ok: false, code: "invalid", message: "Send a JPEG, PNG or WebP photo under about 3.5 MB." };
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, code: "not_configured", message: "Photo analysis isn't set up on the server yet." };
    const day = new Date().toISOString().slice(0, 10);
    const uid = `plate:${userId}:${day}`;
    const used = await this.records.get<{ n: number }>("usage", uid);
    if ((used?.data.n ?? 0) >= 10) return { ok: false, code: "limit", message: "10 photos a day. Try again tomorrow." };
    await this.records.put({ id: uid, kind: "usage", key: day, ownerId: userId, data: { n: (used?.data.n ?? 0) + 1 } });

    let parsed: any;
    try {
      const res = await this.http("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
          max_tokens: 800,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
            { type: "text", text: PROMPT },
          ] }],
        }),
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
      const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch (err) {
      console.warn("plate analysis failed", (err as Error).message);
      return { ok: false, code: "failed", message: "Couldn't read that photo. Try again with the whole plate in view and good light." };
    }
    return { ok: true, value: judgePlate(p, parsed, today) };
  }
}

/** Pure: turn the model's JSON into flags and plan fit for this player. */
export function judgePlate(p: import("../domain/profile.js").AthleteProfile, parsed: any, today: string): PlateResult {
  const c = safetyContext(p);
  const items: PlateItem[] = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 15).map((i: any) => ({
    name: String(i?.name || "").slice(0, 60),
    portion: String(i?.portion || "").slice(0, 40),
    group: String(i?.group || "other").slice(0, 12),
    possibleAllergens: (Array.isArray(i?.possibleAllergens) ? i.possibleAllergens : []).map((a: unknown) => String(a)).slice(0, 10),
  })).filter((i: PlateItem) => i.name);
  const flags: string[] = [];
  for (const it of items) {
    const hit = it.possibleAllergens.filter((a) => c.allergens.includes(a));
    if (hit.length) flags.push(`${it.name}: may contain ${hit.join(", ").replace(/_/g, " ")}. Don't eat it unless you know how it was made.`);
    const why = unsafeReason({ name: it.name.toLowerCase(), keywords: [it.name.toLowerCase()] }, c);
    if (why && !hit.length) flags.push(`${it.name}: ${why}.`);
  }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 5000 ? Math.round(v) : null);
  const carbs = n(parsed?.carbsG), protein = n(parsed?.proteinG), kcal = n(parsed?.kcal);
  const type = classifyDay(p, today);
  const fit: string[] = [];
  const groups = new Set(items.map((i) => i.group));
  if (!groups.has("starch") && (type === "match" || type === "match_eve" || type === "training")) fit.push("Add a starch (rice, pasta, bread, potato). Today needs fuel.");
  if (!groups.has("protein") && !groups.has("dairy")) fit.push("Add a protein: meat, fish, eggs, beans, tofu or dairy.");
  if (!groups.has("fruit") && !groups.has("veg")) fit.push("Add fruit or vegetables for color.");
  if (!fit.length) fit.push("Balanced plate. Nice.");
  if (protein !== null && protein < 15 && (effectiveAgeOf(p) ?? 18) >= 13) fit.push(`About ${protein} g protein. Aim for 20 g or more at meals.`);
  return {
    items, estimates: { carbsG: carbs, proteinG: protein, kcal }, flags, fit,
    disclaimer: "Estimates from a photo can be off, and a photo can't show hidden ingredients or cross-contact. Always check with whoever made the food.",
  };
}

import { effectiveAge } from "../domain/profile.js";
const effectiveAgeOf = (p: import("../domain/profile.js").AthleteProfile) => effectiveAge(p.identity);
