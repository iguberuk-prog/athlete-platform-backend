/**
 * Team meal planner: one order that's safe for the whole roster.
 *
 * For a team dinner, a tournament lunch or the half-time snack rotation, the
 * coach or team parent gets foods that pass every player's rules, plus a
 * short list of players who need their own plate and why (allergen names
 * only, never medical details).
 */

import type { AthleteProfile } from "./profile.js";
import { FOODS, safetyContext, unsafeReason, type Food, type FoodRole } from "./foods.js";

export interface TeamMenu {
  players: number;
  sections: { title: string; forEveryone: string[] }[];
  separatePlates: { name: string; avoid: string[] }[];
  tips: string[];
}

const SECTIONS: { title: string; roles: FoodRole[]; n: number }[] = [
  { title: "Main starch", roles: ["meal_carb"], n: 4 },
  { title: "Protein", roles: ["protein"], n: 4 },
  { title: "Fruit and veg", roles: ["fruit", "veg"], n: 5 },
  { title: "Half-time snacks", roles: ["halftime"], n: 4 },
  { title: "After-game snacks", roles: ["recovery", "snack"], n: 5 },
  { title: "Drinks", roles: ["fluid", "in_game"], n: 3 },
];

export function teamMenu(roster: AthleteProfile[], opts: { gameDay?: boolean } = {}): TeamMenu {
  const ctxs = roster.map((p) => ({ p, c: safetyContext(p, { gameDay: opts.gameDay }) }));
  const okForAll = (f: Food) => ctxs.every(({ c }) => !unsafeReason(f, c));
  const sections = SECTIONS.map((s) => ({
    title: s.title,
    forEveryone: FOODS.filter((f) => f.roles.some((r) => s.roles.includes(r)) && !f.roles.includes("ingredient") && okForAll(f))
      .slice(0, s.n).map((f) => f.name),
  }));
  // Players with rules that knocked out common team foods.
  const common = ["pasta", "bagel", "chicken", "turkey", "greek_yogurt", "milk", "pb", "granola", "cheese", "eggs"].map((id) => FOODS.find((f) => f.id === id)).filter((f): f is Food => !!f);
  const separatePlates: TeamMenu["separatePlates"] = [];
  for (const { p, c } of ctxs) {
    const out = common.filter((f) => unsafeReason(f, c)).map((f) => f.name);
    const strict = c.strictAllergens.length || (p.nutrition.allergies || []).some((a) => a.epinephrine);
    if (out.length || strict) {
      const first = (p.identity.fullName || "").trim().split(/\s+/);
      separatePlates.push({ name: `${first[0]} ${first[1]?.[0] ? first[1][0] + "." : ""}`.trim(), avoid: [...new Set([...c.allergens.map((a) => a.replace("_", " ")), ...out])].slice(0, 8) });
    }
  }
  const tips = [
    "Order the safe items for everyone, then a separate plate for the players listed.",
    "Ask the restaurant to keep the separate plates apart and labeled.",
  ];
  if (roster.some((p) => (p.nutrition.allergies || []).some((a) => a.epinephrine)))
    tips.unshift("At least one player carries an EpiPen. Make sure it's at the meal.");
  if (sections.some((s) => !s.forEveryone.length))
    tips.push("One section has no food that's safe for everyone. Plan individual options there.");
  return { players: roster.length, sections, separatePlates, tips };
}
