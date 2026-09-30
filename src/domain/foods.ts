/**
 * The food catalog and the food-safety rules.
 *
 * EVERY food the app mentions (plans, timelines, reminders, recovery, grocery
 * lists) comes from this catalog and passes `isSafe()`. Engines never write a
 * food name into text directly; they call `examples()` / `pick()` so a food
 * that is unsafe for the athlete can't appear anywhere.
 *
 * A food is excluded when ANY of these hit:
 *   - allergens (incl. "may contain" cross-contact when the athlete asks for strict avoidance)
 *   - free-text allergies or foods they won't eat (matched against names and keywords)
 *   - diets: vegan, vegetarian, pescatarian, halal, kosher, no pork, no red meat,
 *     dairy-free, gluten-free, nut-free
 *   - intolerances: lactose, gluten, fructose, caffeine
 *   - medical diets: celiac (strict gluten incl. oats cross-contact), low-FODMAP,
 *     sensitive stomach (no high-fat / high-fibre before games)
 *   - age: no caffeine under 18, no gels or chews under 15, no protein powders under 15
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";

export type FoodRole =
  | "meal_carb" | "quick_carb" | "in_game" | "halftime" | "breakfast" | "snack"
  | "protein" | "slow_protein" | "recovery" | "fruit" | "veg" | "calcium" | "fluid"
  | "cooling" | "warm" | "salty";

export interface FoodTags {
  allergens?: string[];
  /** Allergens it commonly "may contain" (cross-contact). */
  mayContain?: string[];
  animal?: boolean;
  meat?: boolean;
  pork?: boolean;
  redMeat?: boolean;
  fish?: boolean;
  shellfish?: boolean;
  /** Contains lactose (lactose-free dairy has allergens: milk but lactose: false). */
  lactose?: boolean;
  gluten?: boolean;
  gelatin?: boolean;
  caffeine?: boolean;
  highFodmap?: boolean;
  /** High fat or fibre: avoided before games for sensitive stomachs. */
  heavy?: boolean;
  minAge?: number;
  keywords?: string[];
}

export interface Food extends FoodTags {
  id: string;
  name: string;
  roles: FoodRole[];
}

const F = (id: string, name: string, roles: FoodRole[], tags: FoodTags = {}): Food => ({ id, name, roles, ...tags });
const WHEAT = { allergens: ["wheat", "gluten"], gluten: true };
const MILK = { allergens: ["milk"], animal: true, lactose: true };

export const FOODS: Food[] = [
  // carbs
  F("rice", "white rice", ["meal_carb"], { keywords: ["rice"] }),
  F("potato", "potatoes", ["meal_carb"], { keywords: ["potato"] }),
  F("sweet_potato", "sweet potatoes", ["meal_carb"], { keywords: ["sweet potato"] }),
  F("pasta", "pasta", ["meal_carb"], { ...WHEAT, keywords: ["pasta", "noodle"] }),
  F("gf_pasta", "gluten-free pasta", ["meal_carb"], { keywords: ["pasta"], mayContain: [] }),
  F("bagel", "a bagel", ["meal_carb", "breakfast", "quick_carb"], { ...WHEAT, keywords: ["bagel", "bread"] }),
  F("toast", "toast", ["breakfast", "quick_carb", "snack"], { ...WHEAT, keywords: ["toast", "bread"] }),
  F("gf_toast", "gluten-free toast", ["breakfast", "quick_carb", "snack"], { keywords: ["toast", "bread"] }),
  F("oats", "oatmeal", ["breakfast"], { mayContain: ["gluten", "wheat"], keywords: ["oat"] }),
  F("rice_cakes", "rice cakes", ["quick_carb", "snack"], { keywords: ["rice cake"] }),
  F("pretzels", "pretzels", ["snack"], { ...WHEAT, keywords: ["pretzel"] }),
  F("crackers", "crackers", ["snack"], { ...WHEAT, keywords: ["cracker"] }),
  F("quinoa", "quinoa", ["meal_carb"], { keywords: ["quinoa"] }),
  F("corn_tortilla", "corn tortillas", ["meal_carb"], { keywords: ["corn", "tortilla"] }),
  // fruit
  F("banana", "a banana", ["quick_carb", "halftime", "snack", "fruit", "breakfast"], { keywords: ["banana"] }),
  F("orange", "orange slices", ["halftime", "fruit", "snack"], { keywords: ["orange", "citrus"] }),
  F("grapes", "grapes", ["fruit", "snack", "halftime"], { keywords: ["grape"] }),
  F("berries", "berries", ["fruit", "breakfast"], { keywords: ["berry", "berries", "strawberr", "blueberr"] }),
  F("apple", "an apple", ["fruit", "snack"], { highFodmap: true, keywords: ["apple"] }),
  F("applesauce", "an applesauce pouch", ["quick_carb", "halftime", "snack"], { highFodmap: true, keywords: ["apple"] }),
  F("dried_fruit", "raisins or dried fruit", ["snack", "quick_carb"], { highFodmap: true, keywords: ["raisin", "dried fruit", "mango"] }),
  F("honey", "honey", ["quick_carb"], { highFodmap: true, keywords: ["honey"] }),
  F("jam", "jam", ["quick_carb"], { keywords: ["jam", "jelly"] }),
  // in-game
  F("water", "water", ["fluid", "in_game"], { keywords: ["water"] }),
  F("sports_drink", "a sports drink", ["in_game", "halftime", "quick_carb", "fluid"], { keywords: ["sports drink", "gatorade"] }),
  F("gel", "a caffeine-free energy gel", ["in_game", "halftime"], { minAge: 15, keywords: ["gel"] }),
  F("chews", "energy chews", ["in_game", "halftime"], { gelatin: true, minAge: 15, keywords: ["chew", "gumm"] }),
  F("electrolytes", "electrolyte tablets", ["fluid"], { minAge: 10, keywords: ["electrolyte"] }),
  // proteins
  F("chicken", "chicken", ["protein"], { animal: true, meat: true, keywords: ["chicken"] }),
  F("turkey", "turkey", ["protein"], { animal: true, meat: true, keywords: ["turkey"] }),
  F("beef", "lean beef", ["protein"], { animal: true, meat: true, redMeat: true, keywords: ["beef", "red meat"] }),
  F("salmon", "salmon", ["protein"], { animal: true, fish: true, allergens: ["fish"], keywords: ["salmon", "fish"] }),
  F("tuna", "tuna", ["protein"], { animal: true, fish: true, allergens: ["fish"], keywords: ["tuna", "fish"] }),
  F("shrimp", "shrimp", ["protein"], { animal: true, shellfish: true, allergens: ["shellfish"], keywords: ["shrimp", "shellfish"] }),
  F("eggs", "eggs", ["protein", "breakfast"], { animal: true, allergens: ["egg"], keywords: ["egg"] }),
  F("greek_yogurt", "Greek yogurt", ["protein", "slow_protein", "recovery", "calcium", "breakfast"], { ...MILK, keywords: ["yogurt", "dairy"] }),
  F("lf_yogurt", "lactose-free yogurt", ["protein", "slow_protein", "recovery", "calcium"], { allergens: ["milk"], animal: true, keywords: ["yogurt", "dairy"] }),
  F("milk", "milk", ["calcium", "slow_protein", "fluid"], { ...MILK, keywords: ["milk", "dairy"] }),
  F("lf_milk", "lactose-free milk", ["calcium", "slow_protein", "fluid"], { allergens: ["milk"], animal: true, keywords: ["milk", "dairy"] }),
  F("choc_milk", "chocolate milk", ["recovery"], { ...MILK, caffeine: false, keywords: ["chocolate milk", "milk", "dairy"] }),
  F("cheese", "cheese", ["calcium", "snack"], { ...MILK, keywords: ["cheese", "dairy"] }),
  F("cottage", "cottage cheese", ["slow_protein", "protein"], { ...MILK, keywords: ["cottage cheese", "cheese", "dairy"] }),
  F("whey", "a whey protein shake", ["recovery"], { allergens: ["milk"], animal: true, minAge: 15, keywords: ["whey", "protein shake", "dairy"] }),
  F("plant_shake", "a pea protein shake", ["recovery"], { minAge: 15, keywords: ["protein shake", "pea"] }),
  F("soy_milk", "soy milk", ["calcium", "slow_protein", "recovery"], { allergens: ["soy"], keywords: ["soy"] }),
  F("tofu", "tofu", ["protein"], { allergens: ["soy"], keywords: ["tofu", "soy"] }),
  F("edamame", "edamame", ["protein", "snack"], { allergens: ["soy"], highFodmap: true, keywords: ["edamame", "soy"] }),
  F("lentils", "lentils", ["protein"], { highFodmap: true, heavy: true, keywords: ["lentil"] }),
  F("beans", "beans", ["protein"], { highFodmap: true, heavy: true, keywords: ["bean"] }),
  F("hummus", "hummus", ["snack", "protein"], { allergens: ["sesame"], highFodmap: true, keywords: ["hummus", "chickpea", "sesame"] }),
  F("pb", "peanut butter", ["snack"], { allergens: ["peanut"], heavy: true, keywords: ["peanut"] }),
  F("almond_butter", "almond butter", ["snack"], { allergens: ["tree_nut"], heavy: true, keywords: ["almond", "nut"] }),
  F("sunbutter", "sunflower seed butter", ["snack"], { heavy: true, mayContain: [], keywords: ["sunflower", "seed"] }),
  F("turkey_sandwich", "a turkey sandwich", ["recovery"], { ...WHEAT, animal: true, meat: true, keywords: ["sandwich", "turkey", "bread"] }),
  F("rice_bowl", "a chicken and rice bowl", ["recovery"], { animal: true, meat: true, keywords: ["rice", "chicken"] }),
  F("tofu_bowl", "a tofu and rice bowl", ["recovery"], { allergens: ["soy"], keywords: ["rice", "tofu", "soy"] }),
  // hot days
  F("freeze_pops", "freeze pops", ["cooling"], { keywords: ["freeze pop", "ice pop", "popsicle"] }),
  F("slushie", "an ice slushie", ["cooling"], { keywords: ["slush"] }),
  F("watermelon", "watermelon", ["cooling", "fruit", "halftime"], { highFodmap: true, keywords: ["watermelon", "melon"] }),
  F("cold_grapes", "frozen grapes", ["cooling", "halftime"], { keywords: ["grape"] }),
  F("salted_rice_cakes", "lightly salted rice cakes", ["salty", "snack"], { keywords: ["rice cake"] }),
  F("salted_pretzels", "salted pretzels", ["salty", "snack"], { ...WHEAT, keywords: ["pretzel"] }),
  F("salted_potatoes", "salted boiled potatoes", ["salty", "meal_carb"], { keywords: ["potato"] }),
  // cold days
  F("broth", "warm broth", ["warm"], { keywords: ["broth", "soup"] }),
  F("chicken_soup", "chicken noodle soup", ["warm", "recovery"], { ...WHEAT, animal: true, meat: true, keywords: ["soup", "chicken", "noodle"] }),
  F("hot_cocoa", "hot cocoa", ["warm", "recovery"], { ...MILK, keywords: ["cocoa", "chocolate", "milk", "dairy"] }),
  F("warm_oatmeal", "warm oatmeal", ["warm", "breakfast"], { mayContain: ["gluten", "wheat"], keywords: ["oat"] }),
  F("herbal_tea", "caffeine-free herbal tea", ["warm", "fluid"], { keywords: ["tea"] }),
  F("warm_rice_bowl", "a warm rice and chicken bowl", ["warm", "recovery"], { animal: true, meat: true, keywords: ["rice", "chicken"] }),
  F("warm_sweet_potato", "a baked sweet potato", ["warm", "meal_carb"], { keywords: ["sweet potato"] }),
  // vegetables
  F("greens", "leafy greens", ["veg", "calcium"], { keywords: ["spinach", "greens", "kale"] }),
  F("carrots", "carrots", ["veg", "snack"], { keywords: ["carrot"] }),
  F("broccoli", "broccoli", ["veg"], { highFodmap: true, keywords: ["broccoli"] }),
];

const byId = new Map(FOODS.map((f) => [f.id, f]));

export type MedicalDiet = "celiac" | "type1_diabetes" | "sensitive_stomach" | "low_fodmap";

/** Everything the rules need, derived once from a profile. */
export interface SafetyContext {
  age?: number;
  allergens: string[];
  /** Allergens where "may contain" must also be avoided. */
  strictAllergens: string[];
  diets: string[];
  intolerances: string[];
  medical: MedicalDiet[];
  /** Lowercased free-text words to exclude: "other" allergy notes + foods they won't eat. */
  blockWords: string[];
  gameDay: boolean;
}

export function safetyContext(profile: AthleteProfile, opts: { gameDay?: boolean } = {}): SafetyContext {
  const n = profile.nutrition || ({} as AthleteProfile["nutrition"]);
  const allergies = n.allergies || [];
  const allergens = allergies.map((a) => a.allergen).filter((a) => a !== "other");
  const strict = allergies
    .filter((a) => a.avoidCrossContact || a.severity === "severe" || a.anaphylaxis)
    .map((a) => a.allergen);
  const medical = (n.medicalDiets || []) as MedicalDiet[];
  // Celiac disease: treat gluten as a strict allergen.
  if (medical.includes("celiac")) { allergens.push("gluten", "wheat"); strict.push("gluten", "wheat"); }
  const words = [
    ...allergies.filter((a) => a.allergen === "other" && a.note).map((a) => a.note as string),
    ...(n.dislikes || []),
  ]
    .flatMap((s) => s.toLowerCase().split(/[,;/]| and | or /))
    .map((s) => s.trim().replace(/s$/, ""))
    .filter((s) => s.length >= 3);
  return {
    age: effectiveAge(profile.identity),
    allergens,
    strictAllergens: strict,
    diets: n.dietaryRestrictions || [],
    intolerances: n.intolerances || [],
    medical,
    blockWords: [...new Set(words)],
    gameDay: !!opts.gameDay,
  };
}

/** Why a food is unsafe, or null when it's safe. */
export function unsafeReason(f: Food | FoodTags & { name?: string; keywords?: string[] }, c: SafetyContext): string | null {
  const tags = f.allergens || [];
  const hit = tags.find((a) => c.allergens.includes(a));
  if (hit) return `contains ${hit}`;
  const cross = (f.mayContain || []).find((a) => c.strictAllergens.includes(a));
  if (cross) return `may contain ${cross}`;
  const d = c.diets;
  if (d.includes("vegan") && (f.animal || f.gelatin || tags.includes("milk") || tags.includes("egg") || f.keywords?.includes("honey"))) return "not vegan";
  if ((d.includes("vegetarian") || d.includes("vegan")) && (f.meat || f.fish || f.shellfish || f.gelatin)) return "not vegetarian";
  if (d.includes("pescatarian") && (f.meat || f.gelatin)) return "not pescatarian";
  if ((d.includes("halal") || d.includes("kosher")) && (f.pork || f.gelatin)) return "not halal/kosher";
  if (d.includes("kosher") && f.shellfish) return "not kosher";
  if (d.includes("no_pork") && f.pork) return "pork";
  if (d.includes("no_red_meat") && (f.redMeat || f.pork)) return "red meat";
  if (d.includes("dairy_free") && tags.includes("milk")) return "dairy";
  if ((d.includes("gluten_free") || c.intolerances.includes("gluten")) && (f.gluten || (f.mayContain || []).includes("gluten") && c.medical.includes("celiac"))) return "gluten";
  if (d.includes("nut_free") && tags.some((a) => a === "peanut" || a === "tree_nut")) return "nuts";
  if (c.intolerances.includes("lactose") && f.lactose) return "lactose";
  if ((c.intolerances.includes("fructose") || c.medical.includes("low_fodmap")) && f.highFodmap) return "high FODMAP";
  if (c.medical.includes("low_fodmap") && f.lactose) return "lactose (low-FODMAP)";
  if ((c.intolerances.includes("caffeine") || (c.age !== undefined && c.age < 18)) && f.caffeine) return "caffeine";
  if (f.minAge !== undefined && c.age !== undefined && c.age < f.minAge) return `not for under ${f.minAge}s`;
  if (c.gameDay && c.medical.includes("sensitive_stomach") && f.heavy) return "heavy before games";
  const hay = [String((f as Food).name || "").toLowerCase(), ...(f.keywords || [])];
  const word = c.blockWords.find((w) => hay.some((h) => h.includes(w) || w.includes(h) && h.length >= 4));
  if (word) return `excluded: ${word}`;
  return null;
}

export const isSafe = (f: Food, c: SafetyContext) => unsafeReason(f, c) === null;

/** Safe foods for a role, in catalog order. */
export function safeFor(c: SafetyContext, role: FoodRole): Food[] {
  return FOODS.filter((f) => f.roles.includes(role) && isSafe(f, c));
}

/** Safe foods from a preferred list of ids (keeps order), topped up from the role. */
export function pick(c: SafetyContext, ids: string[], n = 3, role?: FoodRole): Food[] {
  const out: Food[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (f && isSafe(f, c) && !out.includes(f)) out.push(f);
    if (out.length >= n) return out;
  }
  if (role) for (const f of safeFor(c, role)) { if (out.length >= n) break; if (!out.includes(f)) out.push(f); }
  return out;
}

/** "a banana, toast or rice cakes" from safe picks; a safe generic fallback when nothing fits. */
export function examples(c: SafetyContext, ids: string[], n = 3, role?: FoodRole, fallback = "a food you know sits well with you"): string {
  const names = pick(c, ids, n, role).map((f) => f.name);
  if (!names.length) return fallback;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export const names = (foods: Food[]) => foods.map((f) => f.name);

export function food(id: string): Food | undefined {
  return byId.get(id);
}

/** Human-readable safety summary for the profile screen and the program. */
export function safetySummary(profile: AthleteProfile) {
  const c = safetyContext(profile);
  const n = profile.nutrition;
  const excluded = FOODS.filter((f) => !isSafe(f, c)).map((f) => ({ name: f.name, why: unsafeReason(f, c) as string }));
  const labelCheck = [
    ...(n.allergies || []).map((a) => (a.allergen === "other" ? a.note || "other allergy" : a.allergen.replace(/_/g, " "))),
    ...(c.medical.includes("celiac") ? ["gluten (celiac: look for certified gluten-free)"] : []),
  ];
  const warnings: string[] = [];
  if ((n.allergies || []).some((a) => a.anaphylaxis || a.epinephrine))
    warnings.push("Carries an epinephrine auto-injector: keep it in the sports bag at every game and practice, and make sure the coach knows.");
  if (c.medical.includes("type1_diabetes"))
    warnings.push("Type 1 diabetes: carb timing here is general guidance, not insulin dosing. Build the game-day plan with your diabetes care team.");
  if (c.medical.includes("celiac")) warnings.push("Celiac disease: oats and many packaged foods need a certified gluten-free label.");
  if (c.medical.includes("sensitive_stomach")) warnings.push("Sensitive stomach: game-day plans skip high-fat and high-fibre foods. Test every game-day food in practice first.");
  if (c.medical.includes("low_fodmap")) warnings.push("Low-FODMAP: work with a dietitian on which foods you tolerate. The app avoids common high-FODMAP foods.");
  const unmatched = (n.allergies || []).filter((a) => a.allergen === "other" && a.note).map((a) => a.note as string);
  if (unmatched.length) warnings.push(`We filter "${unmatched.join(", ")}" by name, but it can hide in packaged foods. Always read labels.`);
  return {
    allergies: (n.allergies || []).map((a) => ({ allergen: a.allergen, note: a.note, severity: a.severity, anaphylaxis: !!a.anaphylaxis, epinephrine: !!a.epinephrine, avoidCrossContact: !!a.avoidCrossContact })),
    diets: c.diets,
    intolerances: c.intolerances,
    medicalDiets: c.medical,
    excluded,
    labelCheck,
    warnings,
    confirmedAt: n.safetyConfirmedAt || null,
  };
}

/** Fill {carbs} {snack} {calcium} {protein} {iron} slots in advice text with foods that are safe for this athlete. */
export function fillText(text: string, c: SafetyContext): string {
  return text
    .replace(/\{carbs\}/g, () => examples(c, ["rice", "pasta", "gf_pasta", "potato", "toast", "gf_toast"], 3, "meal_carb", "the carbs you tolerate"))
    .replace(/\{snack\}/g, () => examples(c, ["banana", "crackers", "rice_cakes", "grapes", "orange"], 2, "snack", "a snack that sits well"))
    .replace(/\{calcium\}/g, () => examples(c, ["milk", "lf_milk", "greek_yogurt", "lf_yogurt", "soy_milk", "cheese", "greens"], 3, "calcium", "calcium-fortified foods"))
    .replace(/\{protein\}/g, () => examples(c, ["greek_yogurt", "eggs", "chicken", "salmon", "tofu", "turkey", "beef", "lentils"], 4, "protein", "the proteins you tolerate"))
    .replace(/\{iron\}/g, () => examples(c, ["beef", "lentils", "beans", "greens", "chicken", "tofu"], 3, undefined, "iron-fortified cereals"));
}
