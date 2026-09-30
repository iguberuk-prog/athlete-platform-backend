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
import { safetyContext, unsafeReason, type FoodTags } from "./foods.js";

export type { Recipe } from "./recipes.js";
import { planCandidates, recipeBook, type Meal, type Recipe, type RecipeFilter } from "./recipes.js";

/** Every recipe that fits this player's food rules and age (default kitchen). */
export function safeRecipes(profile: AthleteProfile): Recipe[] {
  return recipeBook(profile).recipes;
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
export function buildMealPlan(profile: AthleteProfile, from: string, days = 7, filter: RecipeFilter = {}): MealPlan {
  const used = new Map<string, number>();
  const out: MealPlanDay[] = [];
  const age = effectiveAge(profile.identity);
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const t = classifyDay(profile, date);
    const gameish = t === "match" || t === "match_eve";
    const meals: MealPlanDay["meals"] = [];
    for (const meal of ["breakfast", "lunch", "dinner", "snack"] as Meal[]) {
      const candidates = planCandidates(profile, meal, gameish, filter)
        .sort((a, b) => {
          const fit = (x: { days: DayType[] }) => (x.days.includes(t) ? 0 : 1);
          return fit(a) - fit(b) || (used.get(a.id) ?? -9) - (used.get(b.id) ?? -9);
        });
      const choice = candidates.find((x) => (used.get(x.id) ?? -9) < i - 1) || candidates[0];
      if (!choice) continue;
      used.set(choice.id, i);
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
  return { from, days: out, recipes: recipeBook(profile, filter).recipes, tips };
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
