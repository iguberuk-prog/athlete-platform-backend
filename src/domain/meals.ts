/**
 * Recipes, weekly meal plan, and the eating-out guide (pure).
 *
 * Every recipe is built from catalog foods. Each ingredient slot lists
 * alternatives in order of preference; the first one that is safe for this
 * player is used (pasta -> gluten-free pasta, milk -> lactose-free -> soy).
 * If a required slot has no safe option, the recipe is dropped. Nothing
 * reaches the screen without passing the same safety rules as everything else.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { bandForAge } from "./ageBands.js";
import { addDays, shortDate } from "./dates.js";
import { classifyDay, type DayType } from "./daily.js";
import { food, isSafe, safetyContext, unsafeReason, type Food, type FoodTags, type SafetyContext } from "./foods.js";

type Meal = "breakfast" | "lunch" | "dinner" | "snack" | "recovery";

interface Slot { ids: string[]; qty: string; optional?: boolean }

interface RecipeDef {
  id: string;
  title: (p: Record<string, string>) => string;
  meals: Meal[];
  /** Best on these day types. */
  days: DayType[];
  minutes: number;
  slots: Record<string, Slot>;
  steps: (p: Record<string, string>) => string[];
  /** Too heavy for the night before or morning of a game. */
  heavy?: boolean;
  minAge?: number;
}

const ALL: DayType[] = ["match", "match_eve", "recovery", "training", "rest"];
const PROTEIN = ["chicken", "turkey", "tofu", "eggs", "salmon"];
const MILKS = ["milk", "lf_milk", "soy_milk"];
const YOGURT = ["greek_yogurt", "lf_yogurt"];
const PASTA = ["pasta", "gf_pasta"];
const SOY = ["soy_sauce", "tamari", "coconut_aminos"];
const FAT = ["olive_oil"];

const RECIPES: RecipeDef[] = [
  {
    id: "overnight_oats", meals: ["breakfast"], days: ALL, minutes: 5,
    title: () => "Overnight oats",
    slots: { oats: { ids: ["oats"], qty: "1/2 cup" }, milk: { ids: MILKS, qty: "1/2 cup" }, yog: { ids: YOGURT, qty: "1/4 cup", optional: true }, fruit: { ids: ["berries", "banana"], qty: "1/2 cup" }, top: { ids: ["chia", "maple"], qty: "1 tsp", optional: true } },
    steps: (p) => [`Stir ${p.oats} with ${p.milk}${p.yog ? ` and ${p.yog}` : ""} in a jar.`, "Refrigerate overnight.", `Top with ${p.fruit}${p.top ? ` and ${p.top}` : ""} in the morning.`],
  },
  {
    id: "breakfast_toast", meals: ["breakfast"], days: ALL, minutes: 10,
    title: (p) => `Scrambled eggs on ${p.toast}`,
    slots: { eggs: { ids: ["eggs"], qty: "2 to 3" }, toast: { ids: ["toast", "gf_toast"], qty: "2 slices" }, fat: { ids: ["butter", ...FAT], qty: "1 tsp" }, fruit: { ids: ["orange", "berries", "banana"], qty: "1 serving" } },
    steps: (p) => [`Whisk the eggs and cook gently in ${p.fat}.`, `Serve on ${p.toast} with ${p.fruit} on the side.`],
  },
  {
    id: "yogurt_parfait", meals: ["breakfast", "snack", "recovery"], days: ALL, minutes: 3,
    title: () => "Yogurt parfait",
    slots: { yog: { ids: YOGURT, qty: "1 cup" }, fruit: { ids: ["berries", "banana"], qty: "1/2 cup" }, crunch: { ids: ["oats"], qty: "1/4 cup", optional: true }, sweet: { ids: ["honey", "maple"], qty: "1 tsp", optional: true } },
    steps: (p) => [`Layer ${p.yog} with ${p.fruit}${p.crunch ? ` and ${p.crunch}` : ""}.`, p.sweet ? `Drizzle with ${p.sweet}.` : "Serve cold."],
  },
  {
    id: "pancakes", meals: ["breakfast"], days: ["match_eve", "rest", "recovery", "match"], minutes: 20,
    title: () => "Banana pancakes",
    slots: { flour: { ids: ["flour", "gf_flour"], qty: "1 cup" }, milk: { ids: MILKS, qty: "3/4 cup" }, banana: { ids: ["banana"], qty: "1 mashed" }, eggs: { ids: ["eggs"], qty: "1", optional: true }, top: { ids: ["maple", "honey", "berries"], qty: "to taste" } },
    steps: (p) => [`Mix ${p.flour}, ${p.milk}, the banana${p.eggs ? " and an egg" : ""} and a pinch of baking powder.`, "Cook small pancakes on a lightly oiled pan.", `Top with ${p.top}. Great for game morning 3+ hours before kickoff.`],
  },
  {
    id: "rice_bowl", meals: ["lunch", "dinner", "recovery"], days: ALL, minutes: 25,
    title: (p) => `${cap(p.protein)} rice bowl`,
    slots: { rice: { ids: ["rice", "quinoa"], qty: "1 to 2 cups cooked" }, protein: { ids: PROTEIN, qty: "a palm-size portion" }, veg: { ids: ["carrots", "cucumber", "peppers", "greens"], qty: "1 cup" }, sauce: { ids: SOY, qty: "1 tbsp", optional: true }, fat: { ids: FAT, qty: "1 tsp" } },
    steps: (p) => [`Cook the ${p.rice}.`, `Cook ${p.protein} in ${p.fat} and slice it.`, `Pile it all in a bowl with ${p.veg}${p.sauce ? ` and a splash of ${p.sauce}` : ""}.`],
  },
  {
    id: "pasta_night", meals: ["dinner"], days: ["match_eve", "training", "rest", "recovery"], minutes: 25,
    title: (p) => `${cap(p.pasta)} with ${p.protein} and tomato sauce`,
    slots: { pasta: { ids: PASTA, qty: "2 cups cooked" }, sauce: { ids: ["tomato_sauce"], qty: "3/4 cup" }, protein: { ids: ["turkey", "chicken", "beef", "tofu", "lentils"], qty: "a palm-size portion" }, cheese: { ids: ["parmesan"], qty: "a sprinkle", optional: true }, veg: { ids: ["greens", "peppers", "carrots"], qty: "1 cup" } },
    steps: (p) => [`Boil the ${p.pasta}.`, `Brown ${p.protein} and simmer it in ${p.sauce} for 10 minutes.`, `Serve with ${p.veg} on the side${p.cheese ? ` and ${p.cheese} on top` : ""}. The classic night-before-game meal.`],
  },
  {
    id: "tacos", meals: ["lunch", "dinner"], days: ["training", "rest", "recovery"], minutes: 20,
    title: (p) => `${cap(p.protein).replace(/s$/, "")} tacos`,
    slots: { shell: { ids: ["corn_tortilla", "flour_tortilla"], qty: "3" }, protein: { ids: ["chicken", "turkey", "beef", "beans", "tofu"], qty: "a palm-size portion" }, veg: { ids: ["peppers", "tomato", "greens"], qty: "1 cup" }, cheese: { ids: ["cheese"], qty: "a small handful", optional: true }, side: { ids: ["rice"], qty: "1 cup cooked" } },
    steps: (p) => [`Cook ${p.protein} with mild taco spices.`, `Warm the ${p.shell}.`, `Fill with ${p.protein}${p.cheese ? `, ${p.veg} and ${p.cheese}` : ` and ${p.veg}`}. Serve with ${p.side}.`],
  },
  {
    id: "sheet_pan", meals: ["dinner", "recovery"], days: ["recovery", "training", "rest"], minutes: 30,
    title: (p) => `Baked ${p.protein} with ${p.carb}`,
    slots: { protein: { ids: ["salmon", "chicken", "tofu"], qty: "a palm-size portion" }, carb: { ids: ["sweet_potato", "potato", "rice"], qty: "1 large or 1.5 cups" }, veg: { ids: ["broccoli", "greens", "carrots"], qty: "1 cup" }, fat: { ids: FAT, qty: "1 tbsp" }, lemon: { ids: ["lemon"], qty: "1 wedge", optional: true } },
    steps: (p) => [`Heat the oven to 400°F.`, `Roast ${p.carb} in ${p.fat} for 25 minutes.`, `Add ${p.protein} and ${p.veg} for the last 12 to 15 minutes${p.lemon ? `, then squeeze ${p.lemon} on top` : ""}.`],
  },
  {
    id: "stir_fry", meals: ["dinner"], days: ["training", "rest", "recovery"], minutes: 20,
    title: (p) => `${cap(p.protein)} stir-fry`,
    slots: { protein: { ids: ["chicken", "tofu", "shrimp", "beef"], qty: "a palm-size portion" }, veg: { ids: ["peppers", "broccoli", "carrots"], qty: "2 cups" }, sauce: { ids: SOY, qty: "2 tbsp" }, carb: { ids: ["rice", "pasta", "gf_pasta"], qty: "1.5 cups cooked" }, fat: { ids: FAT, qty: "1 tbsp" } },
    steps: (p) => [`Cook ${p.carb}.`, `Stir-fry ${p.protein} in ${p.fat} on high heat, then add ${p.veg}.`, `Add ${p.sauce}, toss, and serve over ${p.carb}.`],
  },
  {
    id: "soup", meals: ["lunch", "dinner"], days: ALL, minutes: 30,
    title: (p) => `${cap(p.protein)} and ${p.carb} soup`,
    slots: { protein: { ids: ["chicken", "turkey", "tofu", "lentils"], qty: "a palm-size portion" }, carb: { ids: ["rice", "pasta", "gf_pasta", "potato"], qty: "1 cup" }, veg: { ids: ["carrots", "greens"], qty: "1 cup" }, broth: { ids: ["broth"], qty: "3 cups" } },
    steps: (p) => [`Simmer ${p.broth} with ${p.veg}.`, `Add ${p.protein} and ${p.carb} and cook until done, about 15 minutes.`, "Great on cold days and when appetite is low."],
  },
  {
    id: "wrap", meals: ["lunch"], days: ALL, minutes: 5,
    title: (p) => `${cap(p.protein)} wrap`,
    slots: { wrap: { ids: ["flour_tortilla", "corn_tortilla", "gf_toast"], qty: "1 large" }, protein: { ids: ["turkey", "chicken", "hummus", "eggs"], qty: "3 to 4 oz" }, veg: { ids: ["greens", "cucumber", "tomato", "carrots"], qty: "a handful" }, cheese: { ids: ["cheese"], qty: "1 slice", optional: true }, fruit: { ids: ["apple", "grapes", "orange", "banana"], qty: "1 serving" } },
    steps: (p) => [`Fill ${p.wrap} with ${p.protein}${p.cheese ? `, ${p.veg} and ${p.cheese}` : ` and ${p.veg}`}.`, `Pack ${p.fruit} on the side. Easy school lunch.`],
  },
  {
    id: "smoothie", meals: ["breakfast", "snack", "recovery"], days: ALL, minutes: 5,
    title: () => "Recovery smoothie",
    slots: { milk: { ids: MILKS, qty: "1 cup" }, fruit: { ids: ["banana", "berries"], qty: "1 cup" }, yog: { ids: YOGURT, qty: "1/2 cup", optional: true }, oats: { ids: ["oats"], qty: "1/4 cup", optional: true }, nut: { ids: ["pb", "sunbutter", "almond_butter"], qty: "1 tbsp", optional: true } },
    steps: (p) => [`Blend ${p.milk}, ${p.fruit}${p.yog ? `, ${p.yog}` : ""}${p.oats ? `, ${p.oats}` : ""}${p.nut ? ` and ${p.nut}` : ""} with ice.`, "Drink within an hour after training."],
  },
  {
    id: "snack_box", meals: ["snack"], days: ALL, minutes: 5,
    title: () => "Snack box",
    slots: { carb: { ids: ["crackers", "rice_cakes", "pretzels"], qty: "a handful" }, protein: { ids: ["cheese", "hummus", "turkey", "edamame"], qty: "a small portion" }, fruit: { ids: ["grapes", "apple", "orange", "berries"], qty: "1 serving" }, veg: { ids: ["carrots", "cucumber"], qty: "a handful", optional: true } },
    steps: (p) => [`Pack ${p.carb}, ${p.protein}, ${p.fruit}${p.veg ? ` and ${p.veg}` : ""} in a container.`],
  },
  {
    id: "rice_cake_stack", meals: ["snack"], days: ["match", "match_eve", "training"], minutes: 2,
    title: (p) => `${cap(p.base)} with ${p.top}`,
    slots: { base: { ids: ["rice_cakes", "toast", "gf_toast", "bagel"], qty: "2" }, top: { ids: ["jam", "honey", "banana", "sunbutter"], qty: "a thin layer" } },
    steps: (p) => [`Spread ${p.top} on ${p.base}. A quick carb snack 1 to 2 hours before play.`],
  },
  {
    id: "sweet_potato_bowl", meals: ["lunch", "dinner"], days: ["recovery", "rest", "training"], minutes: 35,
    title: (p) => `Stuffed ${p.base.replace(/es$/, "")} with ${p.protein}`,
    slots: { base: { ids: ["sweet_potato", "potato"], qty: "1 large" }, protein: { ids: ["beans", "chicken", "turkey", "tofu"], qty: "a palm-size portion" }, top: { ids: ["greek_yogurt", "lf_yogurt", "cheese"], qty: "2 tbsp", optional: true }, veg: { ids: ["greens", "peppers", "tomato"], qty: "1 cup" } },
    steps: (p) => [`Bake or microwave ${p.base} until soft.`, `Split it and fill with ${p.protein} and ${p.veg}${p.top ? `, then top with ${p.top}` : ""}.`],
  },
];

const cap = (s: string) => s.replace(/^(a |an )/, "").replace(/^\w/, (c) => c.toUpperCase());

export interface Recipe {
  id: string;
  name: string;
  meals: Meal[];
  minutes: number;
  ingredients: { name: string; qty: string }[];
  steps: string[];
  swaps: string[];
}

function build(def: RecipeDef, c: SafetyContext, avoidHeavy = false): Recipe | null {
  const picks: Record<string, string> = {};
  const ingredients: Recipe["ingredients"] = [];
  const swaps: string[] = [];
  for (const [key, slot] of Object.entries(def.slots)) {
    const options = slot.ids.map((id) => food(id)).filter((f): f is Food => !!f);
    const chosen = options.find((f) => isSafe(f, c) && !(avoidHeavy && f.heavy));
    if (!chosen) {
      if (slot.optional) continue;
      return null;
    }
    if (chosen !== options[0]) swaps.push(`Uses ${chosen.name} to fit your food rules.`);
    picks[key] = chosen.name;
    ingredients.push({ name: chosen.name, qty: slot.qty });
  }
  return { id: def.id, name: def.title(picks), meals: def.meals, minutes: def.minutes, ingredients, steps: def.steps(picks), swaps };
}

export function safeRecipes(profile: AthleteProfile): Recipe[] {
  const c = safetyContext(profile);
  return RECIPES.map((d) => build(d, c)).filter((r): r is Recipe => !!r);
}

export interface MealPlanDay {
  date: string;
  label: string;
  dayType: DayType;
  note: string;
  meals: { meal: Meal; recipe: Recipe }[];
}

export interface MealPlan {
  from: string;
  days: MealPlanDay[];
  recipes: Recipe[];
  tips: string[];
}

const DAY_NOTE: Record<DayType, string> = {
  match: "Game day: breakfast 3+ hours before kickoff, then recovery within an hour after.",
  match_eve: "Night before a game: carb-rich dinner, nothing new or spicy.",
  recovery: "Day after a game: extra protein and color to repair.",
  training: "Training day: snack about an hour before practice.",
  rest: "Rest day: regular balanced meals.",
};

/** A 7-day plan: breakfast, lunch, dinner and a snack, rotated so meals don't repeat back to back. */
export function buildMealPlan(profile: AthleteProfile, from: string, days = 7): MealPlan {
  const c = safetyContext(profile);
  const gameC = safetyContext(profile, { gameDay: true });
  const used = new Map<string, number>();
  const out: MealPlanDay[] = [];
  const age = effectiveAge(profile.identity);
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const t = classifyDay(profile, date);
    const gameish = t === "match" || t === "match_eve";
    const ctx = gameish ? gameC : c;
    const meals: MealPlanDay["meals"] = [];
    for (const meal of ["breakfast", "lunch", "dinner", "snack"] as Meal[]) {
      const candidates = RECIPES
        .filter((d) => d.meals.includes(meal) && (d.minAge === undefined || (age ?? 99) >= d.minAge))
        .map((d) => ({ d, r: build(d, ctx, gameish) }))
        .filter((x): x is { d: RecipeDef; r: Recipe } => !!x.r)
        .sort((a, b) => {
          const fit = (x: RecipeDef) => (x.days.includes(t) ? 0 : 1);
          return fit(a.d) - fit(b.d) || (used.get(a.d.id) ?? -9) - (used.get(b.d.id) ?? -9);
        });
      const choice = candidates.find((x) => (used.get(x.d.id) ?? -9) < i - 1) || candidates[0];
      if (!choice) continue;
      used.set(choice.d.id, i);
      meals.push({ meal, recipe: choice.r });
    }
    out.push({ date, label: shortDate(date), dayType: t, note: DAY_NOTE[t], meals });
  }
  const band = bandForAge(age);
  const tips = [
    band.targetsMode === "plates" ? "Half the plate starch, a quarter protein, a quarter fruit or veg. More starch on busy days." : "Scale the starch up on game and hard training days, down on rest days.",
    "Cook once, eat twice: double the dinner recipe and use it for tomorrow's lunch.",
    "Always read labels. Recipes use safe choices, but brands change what's in them.",
  ];
  return { from, days: out, recipes: safeRecipes(profile), tips };
}

// ---------------------------------------------------------------------------
// Eating out: by restaurant type, not by chain (menus change, we don't guess)
// ---------------------------------------------------------------------------

interface Option extends FoodTags { name: string; when: "before" | "after" | "any" }

const O = (name: string, when: Option["when"], tags: FoodTags = {}): Option => ({ name, when, ...tags });
const W = { allergens: ["wheat", "gluten"], gluten: true };
const DAIRY = { allergens: ["milk"], lactose: true, animal: true };
const CHICKEN = { animal: true, meat: true, keywords: ["chicken"] };

const PLACES: { id: string; name: string; options: Option[]; ask: string[] }[] = [
  { id: "burger", name: "Burger place", options: [
    O("Grilled chicken sandwich", "any", { ...W, ...CHICKEN, mayContain: ["sesame"], keywords: ["chicken", "bread"] }),
    O("Plain hamburger", "after", { ...W, animal: true, meat: true, redMeat: true, mayContain: ["sesame"], keywords: ["beef", "bread"] }),
    O("Lettuce-wrapped burger", "after", { animal: true, meat: true, redMeat: true, keywords: ["beef"] }),
    O("Apple slices or fruit cup", "any", { highFodmap: true, keywords: ["apple"] }),
    O("Milk", "after", { ...DAIRY, keywords: ["milk"] }),
  ], ask: ["Fries often share a fryer with breaded foods: ask if you avoid gluten or have a strict allergy.", "Buns often have sesame seeds."] },
  { id: "pizza", name: "Pizza and Italian", options: [
    O("Pasta with tomato sauce", "any", { ...W, keywords: ["pasta"] }),
    O("Pasta with grilled chicken", "any", { ...W, ...CHICKEN, keywords: ["pasta", "chicken"] }),
    O("Cheese pizza, 2 slices with a side salad", "after", { ...W, ...DAIRY, heavy: true, keywords: ["pizza", "cheese"] }),
    O("Gluten-free pasta with tomato sauce", "any", { keywords: ["pasta"], mayContain: ["gluten", "wheat"] }),
  ], ask: ["Pesto usually has pine nuts or other nuts.", "Gluten-free pasta is often cooked in the same water as regular pasta: ask."] },
  { id: "mexican", name: "Mexican or burrito bowl", options: [
    O("Rice bowl with chicken, mild salsa and lettuce", "any", { ...CHICKEN, keywords: ["rice", "chicken"] }),
    O("Rice and bean bowl", "after", { highFodmap: true, heavy: true, keywords: ["rice", "bean"] }),
    O("Soft corn tacos with chicken", "any", { ...CHICKEN, keywords: ["corn", "tortilla", "chicken"] }),
    O("Burrito with chicken and rice", "after", { ...W, ...CHICKEN, keywords: ["tortilla", "chicken", "rice"] }),
  ], ask: ["Skip the queso, sour cream and fried chips before a game.", "Ask what the rice and beans are cooked with if you avoid meat or pork (some use lard)."] },
  { id: "subs", name: "Sub or sandwich shop", options: [
    O("Turkey sub on white bread with veggies", "any", { ...W, animal: true, meat: true, keywords: ["turkey", "bread"] }),
    O("Grilled chicken wrap", "any", { ...W, ...CHICKEN, keywords: ["chicken", "tortilla"] }),
    O("Chicken salad bowl with a roll", "after", { ...W, ...CHICKEN, keywords: ["chicken", "bread"] }),
    O("Baked chips or pretzels", "any", { ...W, keywords: ["pretzel"] }),
  ], ask: ["Sliced meats and cheeses share a slicer: a real risk with strict allergies.", "Go light on mayo before a game."] },
  { id: "asian", name: "Asian (Chinese, Japanese, Thai)", options: [
    O("Chicken teriyaki with white rice", "any", { ...CHICKEN, allergens: ["soy", "wheat", "gluten"], gluten: true, keywords: ["chicken", "rice", "soy"] }),
    O("Plain white rice with steamed chicken and vegetables", "any", { ...CHICKEN, keywords: ["rice", "chicken"] }),
    O("Cooked sushi rolls (cucumber, avocado, cooked salmon)", "any", { allergens: ["fish", "soy"], fish: true, animal: true, mayContain: ["shellfish", "sesame"], keywords: ["sushi", "salmon", "fish", "rice"] }),
    O("Noodle soup with chicken", "after", { ...W, ...CHICKEN, keywords: ["noodle", "soup", "chicken"] }),
  ], ask: ["Many dishes use peanuts, peanut oil, sesame or fish sauce. Tell the server about every allergy.", "Skip anything fried or spicy before a game."] },
  { id: "breakfast", name: "Diner or breakfast place", options: [
    O("Pancakes or waffles with fruit and syrup", "any", { ...W, allergens: ["wheat", "gluten", "egg", "milk"], animal: true, keywords: ["pancake"] }),
    O("Scrambled eggs, toast and fruit", "any", { ...W, allergens: ["wheat", "gluten", "egg"], animal: true, keywords: ["egg", "toast", "bread"] }),
    O("Oatmeal with banana", "any", { mayContain: ["gluten", "wheat"], keywords: ["oat", "banana"] }),
    O("Bagel with jam", "any", { ...W, keywords: ["bagel", "bread"] }),
  ], ask: ["Skip the bacon, sausage and home fries 3 hours before a game: too heavy.", "Pancake batter often has milk and eggs."] },
  { id: "chicken", name: "Chicken place", options: [
    O("Grilled chicken with rice or a baked potato", "any", { ...CHICKEN, keywords: ["chicken", "rice", "potato"] }),
    O("Grilled chicken sandwich", "any", { ...W, ...CHICKEN, keywords: ["chicken", "bread"] }),
    O("Fried chicken tenders", "after", { ...W, ...CHICKEN, heavy: true, keywords: ["chicken"] }),
  ], ask: ["Fried chicken is often soaked in buttermilk and breaded with wheat."] },
  { id: "gas", name: "Gas station or convenience store", options: [
    O("Banana", "any", { keywords: ["banana"] }),
    O("Pretzels", "any", { ...W, keywords: ["pretzel"] }),
    O("Sports drink", "any", { keywords: ["sports drink"] }),
    O("String cheese", "any", { ...DAIRY, keywords: ["cheese"] }),
    O("Low-fat chocolate milk", "after", { ...DAIRY, keywords: ["chocolate milk", "milk"] }),
    O("Turkey jerky", "after", { animal: true, meat: true, keywords: ["jerky", "turkey"] }),
  ], ask: ["Check every wrapper. Packaged snacks change recipes often."] },
];

export interface EatingOutGuide {
  places: { id: string; name: string; before: string[]; after: string[]; ask: string[] }[];
  general: string[];
}

export function eatingOutGuide(profile: AthleteProfile): EatingOutGuide {
  const c = safetyContext(profile);
  const g = safetyContext(profile, { gameDay: true });
  const strict = c.strictAllergens.length > 0;
  const places = PLACES.map((p) => {
    const before = p.options.filter((o) => o.when !== "after" && !unsafeReason(o, g) && !o.heavy).map((o) => o.name);
    const after = p.options.filter((o) => !unsafeReason(o, c)).filter((o) => o.when !== "before").map((o) => o.name);
    const ask = [...p.ask];
    if (p.id === "asian" && c.allergens.some((a) => a === "peanut" || a === "tree_nut" || a === "sesame"))
      ask.unshift("High-risk kitchen for your allergy. Choose another place if you can.");
    return { id: p.id, name: p.name, before, after, ask };
  }).filter((p) => p.before.length || p.after.length);
  const general = [
    "Before a game: a plain starch (rice, pasta, bread, potato) plus a lean protein. Skip fried, creamy and spicy.",
    "After a game: a full plate with protein within 1 to 2 hours, plus a drink.",
    "Menus change. Always tell the server about allergies, every time, even at places you know.",
  ];
  if (strict) general.unshift("Strict allergy: ask to speak to the manager, and ask about shared fryers, grills and slicers.");
  if ((profile.nutrition.allergies || []).some((a) => a.epinephrine)) general.unshift("Bring the EpiPen into the restaurant. Never leave it in the car.");
  return { places, general };
}
