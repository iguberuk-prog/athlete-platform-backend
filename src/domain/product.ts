/**
 * Product scanner analysis (pure).
 *
 * Input: a packaged food from Open Food Facts (barcode lookup).
 * Output, for this player:
 *   1. Safe for them at all? (allergies, may-contain, diets, intolerances,
 *      medical diets, foods they won't eat, age rules). Missing data is never
 *      treated as safe.
 *   2. Side by side timing: right now, before the next game or practice,
 *      during play, after (recovery).
 *   3. Full breakdown per serving, plus everything about it that works
 *      against a soccer player.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { safetyContext, unsafeReason, type FoodTags } from "./foods.js";
import { sortedEvents, eventDate, eventTime, routineOf, to12, toMin } from "./dates.js";

/** The subset of an Open Food Facts product we use. */
export interface OffProduct {
  code: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  allergens_tags?: string[];
  traces_tags?: string[];
  ingredients_text?: string;
  ingredients_text_en?: string;
  ingredients_analysis_tags?: string[];
  labels_tags?: string[];
  categories_tags?: string[];
  additives_tags?: string[];
  nutriments?: Record<string, number | string | undefined>;
  nova_group?: number;
  nutriscore_grade?: string;
  image_front_small_url?: string;
}

export type Verdict = "avoid" | "caution" | "ok" | "good";

export interface TimingCell {
  window: "now" | "before" | "during" | "after";
  label: string;
  verdict: Verdict;
  why: string;
}

export interface ProductAnalysis {
  code: string;
  name: string;
  brand?: string;
  image?: string;
  basis: string;
  /** Can this player eat it at all? */
  safety: { verdict: Verdict; reasons: string[]; mayContain: string[]; unknown: boolean };
  overall: { verdict: Verdict; summary: string };
  timing: TimingCell[];
  nutrition: { label: string; value: string; note?: string }[];
  bad: string[];
  good: string[];
  ingredients?: string;
  source: string;
}

const OFF_ALLERGEN: Record<string, string> = {
  "en:milk": "milk", "en:eggs": "egg", "en:peanuts": "peanut", "en:nuts": "tree_nut", "en:soybeans": "soy",
  "en:gluten": "gluten", "en:fish": "fish", "en:crustaceans": "shellfish", "en:molluscs": "shellfish", "en:sesame-seeds": "sesame",
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const has = (text: string, re: RegExp) => re.test(text);

/** Nutrient per serving if the serving is known, otherwise per 100 g. */
function nutrient(p: OffProduct, key: string, perServing: boolean, grams: number | null): number | null {
  const n = p.nutriments || {};
  if (perServing) {
    const s = num(n[`${key}_serving`]);
    if (s !== null) return s;
    const h = num(n[`${key}_100g`]);
    return h !== null && grams ? (h * grams) / 100 : null;
  }
  return num(n[`${key}_100g`]);
}

const r0 = (n: number | null) => (n === null ? null : Math.round(n));
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export interface ScanContext {
  /** Local "YYYY-MM-DDTHH:MM". */
  now: string;
  /** Feels-like °F at the next event, if known. */
  hot?: boolean;
}

export function analyzeProduct(profile: AthleteProfile, p: OffProduct, ctx: ScanContext): ProductAnalysis {
  const age = effectiveAge(profile.identity) ?? 18;
  const kid = age < 13;
  const ing = (p.ingredients_text_en || p.ingredients_text || "").toLowerCase();
  const name = (p.product_name || "Unknown product").trim();
  const cats = (p.categories_tags || []).join(" ");
  const labels = p.labels_tags || [];
  const analysis = p.ingredients_analysis_tags || [];

  // --- tags for the shared safety rules ----------------------------------
  const allergens = [...new Set((p.allergens_tags || []).map((t) => OFF_ALLERGEN[t]).filter(Boolean))];
  if (allergens.includes("gluten") || has(ing, /\bwheat\b/)) allergens.push("wheat");
  const traces = [...new Set((p.traces_tags || []).map((t) => OFF_ALLERGEN[t]).filter(Boolean))];
  const glutenFree = labels.includes("en:gluten-free") || labels.includes("en:no-gluten");
  const pork = has(ing, /\b(pork|bacon|ham|lard|prosciutto|pepperoni|salami)\b/);
  const gelatin = has(ing, /gelatin|gelatine/);
  const meat = pork || has(ing, /\b(beef|chicken|turkey|pork|lamb|veal|meat|bacon|ham|jerky)\b/) || has(cats, /en:meats/);
  const fish = has(ing, /\b(fish|salmon|tuna|anchov|cod|sardine)/) || allergens.includes("fish");
  const shellfish = allergens.includes("shellfish");
  const caffeine = has(ing, /caffeine|guarana|coffee|green tea extract|yerba mate|kola nut|matcha|\btea\b/) || (num(p.nutriments?.caffeine_100g) ?? 0) > 0 || has(cats, /energy-drinks|coffees/);
  const energyDrink = has(cats, /en:energy-drinks/) || has(ing, /taurine/) || /energy drink/i.test(name);
  const supplement = has(cats, /dietary-supplements|protein-powders|en:pre-workout/) || has(ing, /creatine|beta-alanine|pre-?workout/);
  const sugarAlcohols = ing.match(/sorbitol|xylitol|maltitol|mannitol|erythritol|isomalt/g) || [];
  const sweeteners = ing.match(/sucralose|aspartame|acesulfame|saccharin|stevia/g) || [];
  const fodmap = has(ing, /inulin|chicory root|high fructose corn syrup|fructose|honey|onion|garlic|agave|sorbitol|mannitol|xylitol|apple juice concentrate/);
  const carbonated = has(ing, /carbonated water/) || has(cats, /carbonated|sodas/);
  const alcohol = (num(p.nutriments?.alcohol_100g) ?? 0) > 0.5 || has(cats, /alcoholic-beverages/);
  const trans = has(ing, /partially hydrogenated/);
  const lactoseFree = labels.some((l) => /lactose-free|no-lactose/.test(l));
  const vegan = analysis.includes("en:vegan");
  const nonVeg = analysis.includes("en:non-vegetarian");
  const nonVegan = analysis.includes("en:non-vegan");

  const servingG = num(p.serving_quantity);
  const perServing = servingG !== null && servingG > 0 && servingG < 2000;
  const basis = perServing ? `per serving${p.serving_size ? ` (${p.serving_size})` : ""}` : "per 100 g (serving size not listed)";
  const kcal = nutrient(p, "energy-kcal", perServing, servingG);
  const carbs = nutrient(p, "carbohydrates", perServing, servingG);
  const sugar = nutrient(p, "sugars", perServing, servingG);
  const fat = nutrient(p, "fat", perServing, servingG);
  const sat = nutrient(p, "saturated-fat", perServing, servingG);
  const fiber = nutrient(p, "fiber", perServing, servingG);
  const protein = nutrient(p, "proteins", perServing, servingG);
  let sodiumG = nutrient(p, "sodium", perServing, servingG);
  if (sodiumG === null) { const salt = nutrient(p, "salt", perServing, servingG); sodiumG = salt === null ? null : salt / 2.5; }
  const sodium = sodiumG === null ? null : sodiumG * 1000;
  const heavy = (fat ?? 0) >= 12 || (fiber ?? 0) >= 6 || (protein ?? 0) >= 25;
  const isDrink = has(cats, /beverages|drinks|waters/);
  const sportsDrink = has(cats, /sports-drinks|isotonic/) || /sports drink|electrolyte|gatorade|powerade|bodyarmor/i.test(name);

  const tags: FoodTags & { name: string } = {
    name: name.toLowerCase(),
    allergens,
    mayContain: traces,
    animal: nonVegan || meat || fish || allergens.includes("milk") || allergens.includes("egg") || undefined,
    meat: meat || nonVeg && !fish ? true : undefined,
    pork: pork || undefined,
    redMeat: has(ing, /\b(beef|lamb|veal|pork|bacon|ham)\b/) || undefined,
    fish: fish || undefined,
    shellfish: shellfish || undefined,
    lactose: allergens.includes("milk") && !lactoseFree ? true : undefined,
    gluten: (allergens.includes("gluten") || has(ing, /\b(wheat|barley|rye|malt)\b/)) && !glutenFree ? true : undefined,
    gelatin: gelatin || undefined,
    caffeine: caffeine || undefined,
    highFodmap: fodmap || undefined,
    heavy: heavy || undefined,
    minAge: energyDrink || supplement || alcohol ? (alcohol ? 21 : 18) : undefined,
    keywords: [name.toLowerCase(), ing].filter(Boolean),
  };

  // --- 1. can they eat it at all? ----------------------------------------
  const c = safetyContext(profile);
  const reasons: string[] = [];
  const why = unsafeReason(tags, c);
  if (why) reasons.push(why.replace(/^contains /, "Contains ").replace(/^may contain /, "May contain "));
  // Look for any other allergens hidden in the text too.
  for (const a of c.allergens) {
    const re: Record<string, RegExp> = { peanut: /peanut/, tree_nut: /almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|brazil nut/, milk: /\bmilk|whey|casein|butter|cream|cheese|yogurt/, egg: /\begg/, soy: /\bsoy/, sesame: /sesame|tahini/, fish: /\bfish|anchov/, shellfish: /shrimp|crab|lobster|shellfish/, wheat: /\bwheat/, gluten: /\bwheat|barley|rye|malt\b/ };
    if (re[a] && re[a].test(ing) && !reasons.some((r) => r.includes(a)) && !(a === "gluten" && glutenFree)) reasons.push(`Ingredients mention ${a.replace("_", " ")}`);
  }
  const diets = c.diets;
  const halalOrKosher = diets.filter((d) => d === "halal" || d === "kosher");
  const certified = halalOrKosher.every((d) => labels.some((l) => l.includes(d)));
  const unknown = !ing && !(p.allergens_tags || []).length;
  const mayContain = traces.filter((t) => c.allergens.includes(t));
  let sVerdict: Verdict = reasons.length ? "avoid" : "ok";
  const sReasons = [...reasons];
  if (sVerdict !== "avoid") {
    if (unknown && (c.allergens.length || c.diets.length || c.medical.length)) { sVerdict = "caution"; sReasons.push("The ingredient list isn't in the database. Read the package label before eating."); }
    if (mayContain.length && !reasons.length) { sVerdict = "caution"; sReasons.push(`Label says it may contain ${mayContain.join(", ")}. Only OK for mild allergies. Check with your doctor's plan.`); }
    if (halalOrKosher.length && !certified) { sVerdict = sVerdict === "ok" ? "caution" : sVerdict; sReasons.push(`Not marked ${halalOrKosher.join(" or ")} in the database. Look for the symbol on the package.`); }
  }
  if (sVerdict === "ok" && c.strictAllergens.length && !(p.traces_tags || []).length)
    sReasons.push(`Severe allergy: the database lists no "may contain" warning, but that can be incomplete. Check the package before eating.`);
  if (c.medical.includes("type1_diabetes") && carbs !== null) sReasons.push(`${Math.round(carbs)} g carbs ${perServing ? "per serving" : "per 100 g"} for insulin dosing.`);

  // --- 3. what's good and bad for a soccer player -------------------------
  const bad: string[] = [];
  const good: string[] = [];
  if (energyDrink) bad.push(age < 18 ? "Energy drink: not for players under 18. Caffeine plus stimulants can cause a racing heart, especially in heat." : "Energy drink: big caffeine hit, can cause jitters, a racing heart and bad sleep. Not a hydration drink.");
  else if (caffeine) bad.push(age < 18 ? "Has caffeine. Not recommended for players under 18." : "Has caffeine. Avoid after 2 PM: it cuts sleep, and sleep is recovery.");
  if (supplement) bad.push(age < 18 ? "Supplement: not recommended under 18. Food first." : "Supplement: only use products third-party tested (NSF Certified for Sport or Informed Sport).");
  if (alcohol) bad.push("Contains alcohol. It slows muscle repair and dehydrates.");
  if (trans) bad.push("Has partially hydrogenated oil (trans fat). Bad for heart health. Skip it.");
  if (sugarAlcohols.length) bad.push(`Has ${[...new Set(sugarAlcohols)].join(", ")}. Sugar alcohols can cause cramps, gas or diarrhea during running.`);
  if (carbonated) bad.push("Carbonated: can cause bloating and side stitches if drunk before or during play.");
  if ((fat ?? 0) >= 12) bad.push(`High fat (${r0(fat)} g): slow to digest. Keep it away from the 3 hours before a game.`);
  if ((sat ?? 0) >= 5) bad.push(`High saturated fat (${r0(sat)} g).`);
  if ((fiber ?? 0) >= 6) bad.push(`High fiber (${r0(fiber)} g): great on normal days, but can upset the stomach right before playing.`);
  if (sugar !== null && sugar >= 20 && !sportsDrink) bad.push(`High sugar (${r0(sugar)} g). OK as quick fuel right before or after hard play, not as an everyday snack.`);
  if (sodium !== null && sodium >= 800 && !ctx.hot) bad.push(`Very salty (${r0(sodium)} mg sodium). Fine after heavy sweating in heat, too much otherwise.`);
  if (p.nova_group === 4) bad.push("Ultra-processed. Fine sometimes, but real food should be the base of the week.");
  if (sweeteners.length && !sugarAlcohols.length) bad.push(`Artificial sweeteners (${[...new Set(sweeteners)].join(", ")}): no fuel for play. Zero-calorie drinks don't give you energy.`);
  if (sportsDrink) good.push("Sports drink: carbs and salt for games over 60 minutes or hot days.");
  if ((protein ?? 0) >= 10) good.push(`Good protein (${r0(protein)} g): helps muscles repair after training.`);
  if ((carbs ?? 0) >= 20 && (fat ?? 0) < 8 && (fiber ?? 0) < 5) good.push(`Easy carbs (${r0(carbs)} g): good fuel for training.`);
  if (allergens.includes("milk") && (protein ?? 0) >= 6) good.push("Dairy: calcium for growing bones.");
  if ((fiber ?? 0) >= 3 && (fiber ?? 0) < 6) good.push("Some fiber: good on non-game days.");
  if (sodium !== null && sodium >= 200 && ctx.hot) good.push("Salt helps on a hot day when you sweat a lot.");

  // --- 2. timing side by side --------------------------------------------
  const next = nextEvent(profile, ctx.now);
  const minsToNext = next ? next.mins : null;
  const eventName = next ? (next.type === "match" ? "the game" : next.type === "training" ? "practice" : "your event") : "your next game or practice";
  const stomachRisk = heavy || carbonated || sugarAlcohols.length > 0 || (fodmap && c.medical.length > 0);
  const quick = (carbs ?? 0) >= 10 && !heavy;
  const cell = (window: TimingCell["window"], label: string, v: Verdict, w: string): TimingCell => ({ window, label, verdict: sVerdict === "avoid" ? "avoid" : v, why: sVerdict === "avoid" ? "Not safe for you." : w });

  const before: TimingCell = stomachRisk
    ? cell("before", `Before ${eventName}`, "avoid", "Hard to digest before play. Eat it 4+ hours before, or save it for after.")
    : caffeine && age < 18 ? cell("before", `Before ${eventName}`, "avoid", "Caffeine isn't recommended under 18.")
    : quick ? cell("before", `Before ${eventName}`, "good", "Quick, easy fuel. Best 1 to 3 hours before, or a small amount 30-60 minutes before.")
    : cell("before", `Before ${eventName}`, "ok", "Fine as part of a meal 3 or more hours before.");
  const during: TimingCell = sportsDrink ? cell("during", "During play", "good", "Made for this. Sip at breaks.")
    : isDrink && !carbonated && !caffeine && (carbs ?? 0) < 15 ? cell("during", "During play", "ok", "Fine to sip at breaks.")
    : quick && (fat ?? 0) < 3 && (fiber ?? 0) < 2 && (protein ?? 0) < 5 ? cell("during", "During play (half-time)", "ok", "Small bites at half-time only.")
    : cell("during", "During play", "avoid", "Stick to water, a sports drink, or fruit like orange slices at half-time.");
  const after: TimingCell = (protein ?? 0) >= 10 && (carbs ?? 0) >= 15 ? cell("after", "After (recovery)", "good", "Carbs plus protein: a great recovery choice within an hour.")
    : (protein ?? 0) >= 10 ? cell("after", "After (recovery)", "good", "Good protein for repair. Add some carbs (fruit, bread, rice).")
    : (carbs ?? 0) >= 20 ? cell("after", "After (recovery)", "ok", "Refuels, but add protein: milk, yogurt, eggs or meat.")
    : cell("after", "After (recovery)", "ok", "Not much for recovery. Pair it with carbs and protein.");
  // Right now depends on how close the next session is.
  let now: TimingCell;
  const hour = Number(ctx.now.slice(11, 13));
  if (minsToNext !== null && minsToNext <= 30) now = { ...during, window: "now", label: minsToNext === 0 ? `Right now (during ${eventName})` : `Right now (${eventName} in ${minsToNext} min)` };
  else if (minsToNext !== null && minsToNext <= 180) now = { ...before, window: "now", label: `Right now (${eventName} at ${to12(next!.time)})`, why: stomachRisk ? `${eventName[0].toUpperCase() + eventName.slice(1)} is less than 3 hours away. ${before.why}` : before.why };
  else if (next && next.recentlyEnded) now = { ...after, window: "now", label: "Right now (just finished)" };
  else if (caffeine && hour >= 14 && sVerdict !== "avoid") now = cell("now", "Right now", "caution", "Caffeine this late can hurt tonight's sleep.");
  else now = cell("now", "Right now", sVerdict === "caution" ? "caution" : bad.length >= 3 ? "caution" : "ok", bad.length >= 3 ? "OK now and then. There are better everyday choices." : "Fine to eat now as part of a normal day.");
  if (sVerdict === "caution" && now.verdict !== "avoid") now = { ...now, verdict: "caution", why: sReasons[0] };

  const nutrition = [
    { label: "Calories", value: kcal === null ? "not listed" : `${r0(kcal)}` },
    { label: "Carbs", value: carbs === null ? "not listed" : `${r0(carbs)} g`, note: sugar !== null ? `${r0(sugar)} g sugar` : undefined },
    { label: "Protein", value: protein === null ? "not listed" : `${r1(protein)} g` },
    { label: "Fat", value: fat === null ? "not listed" : `${r1(fat)} g`, note: sat !== null ? `${r1(sat)} g saturated` : undefined },
    { label: "Fiber", value: fiber === null ? "not listed" : `${r1(fiber)} g` },
    { label: "Sodium", value: sodium === null ? "not listed" : `${r0(sodium)} mg` },
  ];
  if (caffeine) nutrition.push({ label: "Caffeine", value: "yes", note: undefined });

  const overallVerdict: Verdict = sVerdict === "avoid" ? "avoid" : sVerdict === "caution" ? "caution" : bad.length >= 3 ? "caution" : good.length >= 2 && bad.length === 0 ? "good" : "ok";
  const who = kid ? profile.identity.fullName.split(/\s+/)[0] : "you";
  const summary = overallVerdict === "avoid" ? `Not safe for ${who}. ${sReasons[0] || ""}`.trim()
    : overallVerdict === "caution" ? (sVerdict === "caution" ? sReasons[0] : "Safe to eat, but not a great choice for an athlete most days.")
    : overallVerdict === "good" ? "A solid choice for a soccer player."
    : "Safe to eat. Timing matters: see below.";

  return {
    code: p.code, name, brand: p.brands?.split(",")[0]?.trim(), image: p.image_front_small_url,
    basis,
    safety: { verdict: sVerdict, reasons: sReasons, mayContain, unknown },
    overall: { verdict: overallVerdict, summary },
    timing: [now, before, during, after],
    nutrition,
    bad, good,
    ingredients: (p.ingredients_text_en || p.ingredients_text || undefined)?.slice(0, 1500),
    source: "Product data: Open Food Facts (openfoodfacts.org), contributed by volunteers. Labels change. Always read the package.",
  };
}

/** Minutes until the next game/practice today or tomorrow, and whether one just ended. */
function nextEvent(profile: AthleteProfile, now: string): { mins: number; time: string; type: string; recentlyEnded: boolean } | null {
  const date = now.slice(0, 10);
  const nowMin = toMin(now.slice(11, 16) || "12:00");
  const r = routineOf(profile);
  let recentlyEnded = false;
  for (const e of sortedEvents(profile)) {
    if (e.type !== "match" && e.type !== "training" && e.type !== "tournament") continue;
    const d = eventDate(e);
    if (d < date) continue;
    const t = toMin(eventTime(e, r.practice));
    const dayOffset = d === date ? 0 : Math.round((Date.parse(d) - Date.parse(date)) / 86_400_000);
    if (dayOffset > 1) break;
    const mins = dayOffset * 1440 + t - nowMin;
    const dur = e.durationMin || (e.type === "match" ? 110 : 90);
    if (mins < 0 && mins > -(dur + 90)) { if (-mins > dur) recentlyEnded = true; else return { mins: 0, time: eventTime(e, r.practice), type: e.type, recentlyEnded: false }; continue; }
    if (mins >= 0) return { mins, time: eventTime(e, r.practice), type: e.type, recentlyEnded };
  }
  return recentlyEnded ? { mins: 99999, time: "", type: "", recentlyEnded } : null;
}

export const isBarcode = (v: unknown): v is string => typeof v === "string" && /^\d{8,14}$/.test(v);
