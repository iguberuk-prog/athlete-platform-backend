/**
 * Weekly grocery list (pure).
 *
 * Adds up the athlete's carbohydrate and protein targets for the next N days
 * (using each day's type: game, practice, recovery, rest), then turns those
 * totals into rough shopping amounts. Every item maps to a food in the central
 * catalog (foods.ts) and is dropped if it's unsafe for this athlete: allergies,
 * cross-contact, diets, intolerances, medical diets, foods they won't eat, age.
 *
 * The age program changes the list: no gels or electrolyte tablets for young
 * kids, calcium foods for growing kids, protein-dense and bone-health foods for
 * 33+. Amounts are approximate and cover the athlete only.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";
import { addDays } from "./dates.js";
import { classifyDay, dailyTargets, type DayType } from "./daily.js";
import { food, isSafe, safetyContext } from "./foods.js";
import { bandForAge } from "./ageBands.js";

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
  program: string;
  dayCounts: Record<DayType, number>;
  weeklyCarbsG: number;
  weeklyProteinG: number;
  sections: GrocerySection[];
  note: string;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Shopping line -> catalog food id (for the safety check). */
interface Line { id: string; label: string; gPer: number; unit: (n: number) => string; share?: number; why?: string }

const CARB_LINES: Line[] = [
  { id: "rice", label: "Rice (white or jasmine)", share: 0.22, gPer: 710, unit: (n) => plural(n, "2 lb bag") },
  { id: "pasta", label: "Pasta", share: 0.18, gPer: 340, unit: (n) => plural(n, "1 lb box", "1 lb boxes") },
  { id: "gf_pasta", label: "Gluten-free pasta", share: 0.18, gPer: 340, unit: (n) => plural(n, "1 lb box", "1 lb boxes") },
  { id: "oats", label: "Rolled oats", share: 0.14, gPer: 810, unit: (n) => plural(n, "42 oz canister") },
  { id: "potato", label: "Potatoes or sweet potatoes", share: 0.12, gPer: 350, unit: (n) => `${n * 2} lb` },
  { id: "toast", label: "Bread or bagels", share: 0.1, gPer: 300, unit: (n) => plural(n, "loaf", "loaves") },
  { id: "gf_toast", label: "Gluten-free bread", share: 0.1, gPer: 250, unit: (n) => plural(n, "loaf", "loaves") },
  { id: "banana", label: "Bananas", share: 0.12, gPer: 27, unit: (n) => `${n} bananas` },
  { id: "berries", label: "Berries, oranges or grapes", share: 0.07, gPer: 60, unit: (n) => `${n} servings` },
  { id: "honey", label: "Honey", share: 0.05, gPer: 280, unit: (n) => plural(n, "12 oz jar") },
];

const PROTEIN_LINES: Line[] = [
  { id: "chicken", label: "Chicken breast", gPer: 140, unit: (n) => `${n} lb` },
  { id: "turkey", label: "Ground turkey", gPer: 115, unit: (n) => `${n} lb` },
  { id: "beef", label: "Lean ground beef", gPer: 115, unit: (n) => `${n} lb` },
  { id: "salmon", label: "Salmon or other fish", gPer: 100, unit: (n) => `${n} lb` },
  { id: "eggs", label: "Eggs", gPer: 72, unit: (n) => plural(n, "dozen", "dozen") },
  { id: "greek_yogurt", label: "Greek yogurt", gPer: 100, unit: (n) => plural(n, "32 oz tub") },
  { id: "lf_yogurt", label: "Lactose-free yogurt", gPer: 80, unit: (n) => plural(n, "32 oz tub") },
  { id: "tofu", label: "Firm tofu", gPer: 40, unit: (n) => plural(n, "14 oz block") },
  { id: "lentils", label: "Lentils or beans (dry)", gPer: 110, unit: (n) => `${n} lb` },
];

export function buildGroceryList(profile: AthleteProfile, from: string, days = 7): GroceryList {
  const age = effectiveAge(profile.identity);
  const band = bandForAge(age);
  const c = safetyContext(profile);
  const ok = (id: string) => { const f = food(id); return !!f && isSafe(f, c); };

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
  // About a third comes from foods outside this list (vegetables, school lunch, recipes).
  const shopCarbs = carbs * 0.65;
  const shopProtein = protein * 0.65;

  // Gluten-free swaps only appear when the regular version is unsafe.
  const carbLines = CARB_LINES.filter((l) => ok(l.id))
    .filter((l) => !(l.id === "gf_pasta" && ok("pasta")) && !(l.id === "gf_toast" && ok("toast")));
  const shareSum = carbLines.reduce((a, l) => a + (l.share || 0), 0) || 1;
  const carbItems = carbLines.map((l) => ({
    name: l.label,
    amount: l.unit(Math.max(1, Math.ceil((shopCarbs * ((l.share || 0) / shareSum)) / l.gPer))),
  }));

  const protLines = PROTEIN_LINES.filter((l) => ok(l.id)).filter((l) => !(l.id === "lf_yogurt" && ok("greek_yogurt"))).slice(0, 4);
  const each = protLines.length ? shopProtein / protLines.length : 0;
  const proteinItems = protLines.map((l) => ({ name: l.label, amount: l.unit(Math.max(1, Math.ceil(each / l.gPer))) }));

  const games = counts.match;
  const sessions = games + counts.training;
  const gameDay: GroceryItem[] = [];
  if (band.inGame === "water_fruit") {
    if (sessions) gameDay.push({ name: "Reusable water bottle (a spare for the bag)", amount: "1", why: "Water is the main drink at this age" });
    if (games && ok("orange")) gameDay.push({ name: "Oranges for half-time slices", amount: `${games * 2}` });
    if (games && ok("sports_drink")) gameDay.push({ name: "Sports drink (small bottles)", amount: `${games}`, why: "Hot days or games over an hour only" });
  } else {
    if (games && ok("sports_drink")) gameDay.push({ name: "Sports drink (20 oz bottles)", amount: `${games * 2}`, why: "One for the game, one for right after" });
    if (games && ok("gel")) gameDay.push({ name: "Caffeine-free energy gels", amount: `${games * 2}`, why: "Half-time and back-up" });
    else if (games && ok("chews")) gameDay.push({ name: "Energy chews", amount: `${games * 2}` });
    if (sessions && ok("electrolytes")) gameDay.push({ name: "Electrolyte tablets or powder", amount: `${sessions} servings`, why: "Hot days and long sessions" });
  }
  const recoveryPick = ["choc_milk", "lf_milk", "soy_milk", "plant_shake", "whey"].find(ok);
  if (sessions && recoveryPick) {
    const label = { choc_milk: "Chocolate milk", lf_milk: "Lactose-free milk", soy_milk: "Soy milk", plant_shake: "Pea protein powder", whey: "Whey protein powder" }[recoveryPick] as string;
    gameDay.push({ name: label, amount: `${sessions} servings`, why: "Recovery drink within 30-60 minutes after" });
  }

  const snacks: GroceryItem[] = [];
  if (ok("rice_cakes")) snacks.push({ name: "Rice cakes", amount: "1 pack" });
  if (ok("pretzels")) snacks.push({ name: "Pretzels", amount: "1 bag" });
  if (ok("dried_fruit")) snacks.push({ name: "Raisins or dried fruit", amount: "1 bag" });
  if (ok("pb")) snacks.push({ name: "Peanut butter", amount: "1 jar" });
  else if (ok("sunbutter")) snacks.push({ name: "Sunflower seed butter", amount: "1 jar", why: "Nut-free spread" });
  if (ok("cheese") && band.id !== "performance" && band.id !== "prime") snacks.push({ name: "Cheese sticks", amount: "1 pack" });

  const produce: GroceryItem[] = [];
  if (ok("greens")) produce.push({ name: "Leafy greens and salad", amount: "2-3 bags" });
  produce.push({ name: "Vegetables for dinners", amount: "5-7 servings" });

  const extras: GroceryItem[] = [];
  const calcium = ["milk", "lf_milk", "soy_milk", "greek_yogurt", "lf_yogurt", "cheese"].filter(ok);
  if (band.id === "foundations" || band.id === "growth") {
    if (calcium.length) extras.push({ name: `Calcium foods: ${calcium.slice(0, 2).map((id) => food(id)!.name).join(" or ")}`, amount: "3 servings a day", why: "Growing bones" });
  }
  if (band.id === "veteran" || band.id === "masters") {
    if (ok("salmon")) extras.push({ name: "Oily fish (salmon, sardines)", amount: "2 meals", why: "Protein plus vitamin D" });
    if (calcium.length) extras.push({ name: `Calcium foods: ${calcium.slice(0, 2).map((id) => food(id)!.name).join(" or ")}`, amount: "2-3 servings a day", why: "Bone health" });
    if (ok("eggs")) extras.push({ name: "Extra eggs for protein at breakfast", amount: "1 dozen", why: "Hit protein at every meal" });
  }

  return {
    profileId: profile.id,
    from,
    to: addDays(from, days - 1),
    program: `${band.name} (${band.ages})`,
    dayCounts: counts,
    weeklyCarbsG: Math.round(carbs),
    weeklyProteinG: Math.round(protein),
    sections: [
      { title: "Carbs (energy)", items: carbItems },
      { title: "Protein (repair)", items: proteinItems },
      { title: "Game and practice day", items: gameDay },
      { title: band.id === "foundations" || band.id === "growth" ? "For growing athletes" : band.id === "veteran" || band.id === "masters" ? "For your age program" : "Extras", items: extras },
      { title: "Snacks", items: snacks },
      { title: "Fruit and vegetables", items: produce },
    ].filter((s) => s.items.length),
    note: "Approximate amounts for the athlete only, filtered for their allergies, diet and food preferences. Always read labels.",
  };
}
