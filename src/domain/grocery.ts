/**
 * Weekly grocery list (pure).
 *
 * Adds up the athlete's carbohydrate and protein targets for the next N days
 * (using each day's type: game, practice, recovery, rest), then turns those
 * totals into rough shopping amounts of foods that are safe for their
 * allergies, diet and intolerances. Game-day extras (sports drinks, gels,
 * electrolytes) scale with the number of games.
 *
 * Amounts are approximate and cover the athlete only. They are a starting
 * list, not a meal plan.
 */

import type { AthleteProfile } from "./profile.js";
import { foodAllowedFor, type FoodTags } from "./plan.js";
import { addDays } from "./dates.js";
import { classifyDay, dailyTargets, type DayType } from "./daily.js";

export interface GroceryItem {
  name: string;
  amount: string;
  why?: string;
}

export interface GrocerySection {
  title: string;
  items: GroceryItem[];
}

export interface GroceryList {
  profileId: string;
  from: string;
  to: string;
  dayCounts: Record<DayType, number>;
  weeklyCarbsG: number;
  weeklyProteinG: number;
  sections: GrocerySection[];
  note: string;
}

interface CarbSource extends FoodTags {
  name: string;
  share: number; // share of weekly carbs
  gPerUnit: number; // grams of carbohydrate per purchase unit
  unit: (n: number) => string;
}

interface ProteinSource extends FoodTags {
  name: string;
  gPerUnit: number; // grams of protein per purchase unit
  unit: (n: number) => string;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const CARBS: CarbSource[] = [
  { name: "Rice (white or jasmine)", share: 0.22, gPerUnit: 710, unit: (n) => plural(n, "2 lb bag") },
  { name: "Pasta", share: 0.18, gPerUnit: 340, unit: (n) => plural(n, "1 lb box", "1 lb boxes"), allergens: ["wheat", "gluten"], gluten: true },
  { name: "Gluten-free pasta", share: 0, gPerUnit: 340, unit: (n) => plural(n, "1 lb box", "1 lb boxes") },
  { name: "Rolled oats", share: 0.14, gPerUnit: 810, unit: (n) => plural(n, "42 oz canister") },
  { name: "Potatoes or sweet potatoes", share: 0.12, gPerUnit: 350, unit: (n) => `${n * 2} lb` },
  { name: "Bread or bagels", share: 0.1, gPerUnit: 300, unit: (n) => plural(n, "loaf", "loaves"), allergens: ["wheat", "gluten"], gluten: true },
  { name: "Bananas", share: 0.12, gPerUnit: 27, unit: (n) => `${n} bananas` },
  { name: "Other fruit (berries, oranges, apples)", share: 0.07, gPerUnit: 60, unit: (n) => `${n} servings` },
  { name: "Honey", share: 0.05, gPerUnit: 280, unit: (n) => plural(n, "12 oz jar") },
];

const PROTEINS: ProteinSource[] = [
  { name: "Chicken breast", gPerUnit: 140, unit: (n) => `${n} lb`, animal: true, meat: true },
  { name: "Lean ground beef or turkey", gPerUnit: 115, unit: (n) => `${n} lb`, animal: true, meat: true },
  { name: "Salmon or other fish", gPerUnit: 100, unit: (n) => `${n} lb`, animal: true, fishOnly: true, allergens: ["fish"] },
  { name: "Eggs", gPerUnit: 72, unit: (n) => plural(n, "dozen", "dozen"), animal: true, allergens: ["egg"] },
  { name: "Greek yogurt", gPerUnit: 100, unit: (n) => plural(n, "32 oz tub"), animal: true, allergens: ["milk"], lactose: true },
  { name: "Milk or lactose-free milk", gPerUnit: 128, unit: (n) => plural(n, "gallon"), animal: true, allergens: ["milk"] },
  { name: "Tofu (firm)", gPerUnit: 40, unit: (n) => plural(n, "14 oz block"), allergens: ["soy"] },
  { name: "Lentils or beans (dry)", gPerUnit: 110, unit: (n) => `${n} lb` },
];

export function buildGroceryList(profile: AthleteProfile, from: string, days = 7): GroceryList {
  const counts: Record<DayType, number> = { match: 0, match_eve: 0, recovery: 0, training: 0, rest: 0 };
  let carbs = 0;
  let protein = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const type = classifyDay(profile, date);
    counts[type]++;
    const t = dailyTargets(profile, date, type);
    carbs += (t.carbsG[0] + t.carbsG[1]) / 2;
    protein += (t.proteinG[0] + t.proteinG[1]) / 2;
  }
  // Roughly a third of carbs and protein come from foods outside this list
  // (vegetables, dairy in recipes, school lunch). Shop for the rest.
  const shopCarbs = carbs * 0.65;
  const shopProtein = protein * 0.65;

  const diets = profile.nutrition.dietaryRestrictions || [];
  const glutenFree = diets.includes("gluten_free") || (profile.nutrition.intolerances || []).includes("gluten");

  const carbSources = CARBS.filter((c) => foodAllowedFor(profile, c)).map((c) =>
    c.name === "Gluten-free pasta" ? { ...c, share: glutenFree ? 0.18 : 0 } : c,
  ).filter((c) => c.share > 0);
  const shareSum = carbSources.reduce((a, c) => a + c.share, 0) || 1;
  const carbItems: GroceryItem[] = carbSources.map((c) => {
    const units = Math.max(1, Math.ceil((shopCarbs * (c.share / shareSum)) / c.gPerUnit));
    return { name: c.name, amount: c.unit(units) };
  });

  const proteinSources = PROTEINS.filter((p) => foodAllowedFor(profile, p)).slice(0, 4);
  const each = proteinSources.length ? shopProtein / proteinSources.length : 0;
  const proteinItems: GroceryItem[] = proteinSources.map((p) => ({
    name: p.name,
    amount: p.unit(Math.max(1, Math.ceil(each / p.gPerUnit))),
  }));

  const games = counts.match;
  const practices = counts.training;
  const gameDay: GroceryItem[] = [];
  if (games > 0) {
    gameDay.push({ name: "Sports drink (20 oz bottles)", amount: `${games * 2}`, why: "One for the game, one for right after" });
    gameDay.push({ name: "Energy gels or chews", amount: `${games * 2}`, why: "Half-time and back-up" });
  }
  if (games + practices > 0) {
    gameDay.push({ name: "Electrolyte tablets or powder", amount: `${games + practices} servings`, why: "Hot days and long sessions" });
    gameDay.push({ name: "Recovery snack (chocolate milk, or a safe alternative)", amount: `${games + practices} servings`, why: "Within 30-60 minutes after" });
  }
  const pretzel: FoodTags = { allergens: ["wheat", "gluten"], gluten: true };
  const snacks: GroceryItem[] = [
    { name: "Rice cakes", amount: "1 pack" },
    ...(foodAllowedFor(profile, pretzel) ? [{ name: "Pretzels", amount: "1 bag" }] : []),
    { name: "Dried fruit (raisins, mango)", amount: "1 bag" },
  ];
  const nutButter: FoodTags = { allergens: ["peanut", "tree_nut"] };
  if (foodAllowedFor(profile, nutButter)) snacks.push({ name: "Peanut butter", amount: "1 jar" });

  const produce: GroceryItem[] = [
    { name: "Leafy greens and salad", amount: "2-3 bags" },
    { name: "Vegetables for dinners (peppers, carrots, broccoli)", amount: "5-7 servings" },
  ];

  return {
    profileId: profile.id,
    from,
    to: addDays(from, days - 1),
    dayCounts: counts,
    weeklyCarbsG: Math.round(carbs),
    weeklyProteinG: Math.round(protein),
    sections: [
      { title: "Carbs (energy)", items: carbItems },
      { title: "Protein (repair)", items: proteinItems },
      { title: "Game and practice day", items: gameDay },
      { title: "Snacks", items: snacks },
      { title: "Fruit and vegetables", items: produce },
    ].filter((s) => s.items.length),
    note: "Approximate amounts for the athlete only. Adjust for what the family already cooks.",
  };
}
