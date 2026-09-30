/**
 * Barcode scanner backend: looks the product up in Open Food Facts (free,
 * open database, no key) and analyzes it for this player.
 *
 * OFF asks apps to send a descriptive User-Agent and keep to about 100 product
 * reads a minute. We cache lookups for a day and cap scans per account.
 */

import type { AthleteProfileRepository, RecordRepository } from "../data/repository.js";
import { analyzeProduct, isBarcode, type OffProduct, type ProductAnalysis } from "../domain/product.js";
import type { FamilyService } from "./familyService.js";

const FIELDS = [
  "code", "product_name", "brands", "quantity", "serving_size", "serving_quantity", "allergens_tags", "traces_tags",
  "ingredients_text", "ingredients_text_en", "ingredients_analysis_tags", "labels_tags", "categories_tags", "additives_tags",
  "nutriments", "nova_group", "nutriscore_grade", "image_front_small_url",
].join(",");

const cache = new Map<string, { at: number; v: OffProduct | null }>();
const UA = process.env.OFF_USER_AGENT || process.env.NWS_USER_AGENT || "AthletePerformance/1.0 (support@example.com)";

export interface ProductLookup { lookup(code: string): Promise<OffProduct | null> }

export class OpenFoodFacts implements ProductLookup {
  async lookup(code: string): Promise<OffProduct | null> {
    const c = cache.get(code);
    if (c && Date.now() - c.at < 86_400_000) return c.v;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, { headers: { "User-Agent": UA }, signal: ctl.signal });
      if (res.status === 404) { cache.set(code, { at: Date.now(), v: null }); return null; }
      if (!res.ok) throw new Error(`Open Food Facts ${res.status}`);
      const j: any = await res.json();
      const v: OffProduct | null = j.status === 1 && j.product ? { ...j.product, code } : null;
      cache.set(code, { at: Date.now(), v });
      if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
      return v;
    } finally {
      clearTimeout(t);
    }
  }
}

export type ScanResult = { ok: true; value: ProductAnalysis } | { ok: false; code: "not_found" | "invalid" | "unknown_product" | "limit" | "unavailable"; message?: string };

const DAILY_LIMIT = 200;

export class ProductService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly off: ProductLookup = new OpenFoodFacts(),
  ) {}

  async scan(userId: string, profileId: string, rawCode: string, now: string, hot = false): Promise<ScanResult> {
    const code = String(rawCode || "").replace(/\D/g, "");
    if (!isBarcode(code)) return { ok: false, code: "invalid", message: "That doesn't look like a product barcode (8 to 14 digits)." };
    const owner = await this.family.ownerFor(userId, profileId);
    if (!owner) return { ok: false, code: "not_found" };
    const p = await this.profiles.getById(owner, profileId);
    if (!p) return { ok: false, code: "not_found" };
    const day = new Date().toISOString().slice(0, 10);
    const key = `scan:${userId}:${day}`;
    const used = await this.records.get<{ n: number }>("usage", key);
    if ((used?.data.n ?? 0) >= DAILY_LIMIT) return { ok: false, code: "limit", message: "Daily scan limit reached. Try again tomorrow." };
    await this.records.put({ id: key, kind: "usage", key: day, ownerId: userId, data: { n: (used?.data.n ?? 0) + 1 } });
    let prod: OffProduct | null;
    try {
      prod = await this.off.lookup(code);
    } catch {
      return { ok: false, code: "unavailable", message: "The product database isn't answering. Try again in a minute." };
    }
    if (!prod) return { ok: false, code: "unknown_product", message: "We couldn't find that product. Read the label, or add it at openfoodfacts.org so it works next time." };
    const safeNow = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(now) ? now.slice(0, 16) : new Date().toISOString().slice(0, 16);
    return { ok: true, value: analyzeProduct(p, prod, { now: safeNow, hot }) };
  }
}
