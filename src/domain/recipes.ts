/**
 * Recipes by age and kitchen (pure).
 *
 * Every recipe knows its equipment and which steps use heat or a sharp knife.
 * The player's age sets what they can make on their own:
 *
 *   6-9    Little chef   no heat, no sharp knives: assemble, spread, mix, pour.
 *                        Anything hotter is "cook together": a grown-up does those steps.
 *   10-12  Junior chef   plus microwave, toaster and blender on their own.
 *                        Stove, oven and sharp knives with a grown-up.
 *   13-15  Home cook     stove, oven and knives, with an adult home.
 *   16+    Cook          the full kitchen, plus batch cooking for the week.
 *
 * Families pick what they have (microwave, oven, blender...), how much time,
 * and who's cooking; the list filters to match. Every ingredient still passes
 * the player's food-safety rules (allergies, diets, medical diets, dislikes).
 *
 * Vendor placements (a brand paying to be the product in a recipe) are built
 * but OFF: they show only when VENDOR_PLACEMENTS=on AND the product passes the
 * same safety and age rules as every other ingredient.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";
import type { DayType } from "./daily.js";
import { food, isSafe, safetyContext, unsafeReason, type Food, type FoodTags, type SafetyContext } from "./foods.js";

export type Meal = "breakfast" | "lunch" | "dinner" | "snack" | "recovery";
export const EQUIPMENT = ["microwave", "toaster", "blender", "freezer", "stove", "oven", "air_fryer", "knife"] as const;
export type Equip = (typeof EQUIPMENT)[number];
export const EQUIP_LABEL: Record<Equip, string> = {
  microwave: "Microwave", toaster: "Toaster", blender: "Blender", freezer: "Freezer", stove: "Stovetop", oven: "Oven", air_fryer: "Air fryer", knife: "Sharp knife",
};
/** 1 = no heat, 2 = small appliances, 3 = stove, oven or sharp knife. */
const LEVEL: Record<Equip, 1 | 2 | 3> = { freezer: 1, microwave: 2, toaster: 2, blender: 2, stove: 3, oven: 3, air_fryer: 3, knife: 3 };

export type Who = "alone" | "together" | "parent";

export interface CookProfile {
  id: "little" | "junior" | "home" | "cook";
  title: string;
  ages: string;
  /** Highest level the player may do on their own. */
  aloneMax: 1 | 2 | 3;
  defaultWho: Who;
  can: string[];
  withGrownUp: string[];
  rules: string[];
}

export function cookProfile(age: number | undefined): CookProfile {
  const a = age ?? 18;
  if (a < 10) return {
    id: "little", title: "Little chef", ages: "6-9", aloneMax: 1, defaultWho: "together",
    can: ["Wash fruit and veg", "Measure and pour", "Mix and stir", "Spread with a table knife", "Build a wrap, parfait or snack box", "Tear lettuce and wash produce"],
    withGrownUp: ["Anything hot: stove, oven, microwave, toaster", "Blender", "Sharp knives"],
    rules: ["Wash hands first, every time.", "A grown-up handles heat and sharp knives.", "Tie back long hair and roll up sleeves."],
  };
  if (a < 13) return {
    id: "junior", title: "Junior chef", ages: "10-12", aloneMax: 2, defaultWho: "together",
    can: ["Everything a little chef does", "Microwave, toaster and blender", "Cut soft foods with a table or plastic knife", "Follow a recipe step by step"],
    withGrownUp: ["Stovetop and oven", "Sharp knives", "Draining anything from a hot pot"],
    rules: ["Use oven mitts for anything from the microwave.", "Never put metal in the microwave.", "Blender lid on before you press start."],
  };
  if (a < 16) return {
    id: "home", title: "Home cook", ages: "13-15", aloneMax: 3, defaultWho: "alone",
    can: ["Stovetop and oven", "Sharp knife with the claw grip", "Cook a full meal", "Make tomorrow's lunch"],
    withGrownUp: ["Cook with an adult at home, at least until you've made a recipe a few times"],
    rules: ["Turn pot handles in, away from the edge.", "Cook chicken until the middle is no longer pink (165°F).", "Stay in the kitchen while the stove is on."],
  };
  return {
    id: "cook", title: "Cook", ages: "16+", aloneMax: 3, defaultWho: "alone",
    can: ["The full kitchen", "Batch cook on Sunday for the week", "Cook for the family on game weeks"],
    withGrownUp: [],
    rules: ["Batch cook grains and protein once, mix and match all week.", "Cooked food keeps 3 to 4 days in the fridge."],
  };
}

// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------

interface Slot { ids: string[]; qty: string; optional?: boolean }
/** A step, optionally tagged with the equipment it uses (drives who does it). */
type Step = string | [string, Equip];

interface RecipeDef {
  id: string;
  title: (p: Record<string, string>) => string;
  meals: Meal[];
  days: DayType[];
  minutes: number;
  serves: number;
  equipment: Equip[];
  slots: Record<string, Slot>;
  steps: (p: Record<string, string>) => Step[];
  kidTip?: string;
  batch?: boolean;
  minAge?: number;
}

const ALL: DayType[] = ["match", "match_eve", "recovery", "training", "rest"];
const TRAIN: DayType[] = ["training", "rest", "recovery"];
const PROTEIN = ["chicken", "turkey", "tofu", "eggs", "salmon"];
const MILKS = ["milk", "lf_milk", "soy_milk"];
const YOGURT = ["greek_yogurt", "lf_yogurt"];
const PASTA = ["pasta", "gf_pasta"];
const SOY = ["soy_sauce", "tamari", "coconut_aminos"];
const FAT = ["olive_oil"];
const SPREAD = ["sunbutter", "pb", "almond_butter"];
const WRAP = ["flour_tortilla", "corn_tortilla"];
const cap = (s: string) => s.replace(/^(a |an )/, "").replace(/^\w/, (c) => c.toUpperCase());
const bare = (s: string) => s.replace(/^(a |an )/, "");

const RECIPES: RecipeDef[] = [
  // ---- no-cook (little chefs on their own) --------------------------------
  {
    id: "yogurt_parfait", meals: ["breakfast", "snack", "recovery"], days: ALL, minutes: 3, serves: 1, equipment: [],
    title: () => "Yogurt parfait",
    slots: { yog: { ids: YOGURT, qty: "1 cup" }, fruit: { ids: ["berries", "banana"], qty: "1/2 cup" }, crunch: { ids: ["oats"], qty: "1/4 cup", optional: true }, sweet: { ids: ["honey", "maple"], qty: "1 tsp", optional: true } },
    steps: (p) => [`Spoon half the ${p.yog} into a cup.`, `Add a layer of ${p.fruit}${p.crunch ? ` and ${p.crunch}` : ""}.`, "Add the rest of the yogurt and top with more fruit.", p.sweet ? `Drizzle with ${p.sweet}.` : "Eat right away or keep cold."],
    kidTip: "Make it look like a flag: stripes of fruit and yogurt.",
  },
  {
    id: "overnight_oats", meals: ["breakfast"], days: ALL, minutes: 5, serves: 1, equipment: [],
    title: () => "Overnight oats",
    slots: { oats: { ids: ["oats"], qty: "1/2 cup" }, milk: { ids: MILKS, qty: "1/2 cup" }, yog: { ids: YOGURT, qty: "1/4 cup", optional: true }, fruit: { ids: ["berries", "banana"], qty: "1/2 cup" }, top: { ids: ["chia", "maple"], qty: "1 tsp", optional: true } },
    steps: (p) => [`Stir ${p.oats} with ${p.milk}${p.yog ? ` and ${p.yog}` : ""} in a jar.`, "Put the lid on and refrigerate overnight.", `In the morning, top with ${p.fruit}${p.top ? ` and ${p.top}` : ""}.`],
    kidTip: "Make it the night before, and breakfast is ready when you wake up.",
  },
  {
    id: "banana_roll", meals: ["snack", "breakfast"], days: ["match", "match_eve", "training"], minutes: 3, serves: 1, equipment: [],
    title: () => "Banana roll-up",
    slots: { wrap: { ids: WRAP, qty: "1" }, spread: { ids: [...SPREAD, "jam"], qty: "1 tbsp" }, banana: { ids: ["banana"], qty: "1" }, sweet: { ids: ["honey", "cinnamon"], qty: "a drizzle", optional: true } },
    steps: (p) => [`Spread ${p.spread} over the ${bare(p.wrap).replace(/s$/, "")}.`, "Lay the banana at one edge and roll it up tight.", p.sweet ? `Add a little ${p.sweet}, then slice into circles with a table knife.` : "Slice into circles with a table knife."],
    kidTip: "Call them banana sushi.",
  },
  {
    id: "snack_box", meals: ["snack", "lunch"], days: ALL, minutes: 5, serves: 1, equipment: [],
    title: () => "Snack box",
    slots: { carb: { ids: ["crackers", "rice_cakes", "pretzels"], qty: "a handful" }, protein: { ids: ["cheese", "hummus", "turkey", "edamame"], qty: "a small portion" }, fruit: { ids: ["grapes", "apple", "orange", "berries"], qty: "1 serving" }, veg: { ids: ["carrots", "cucumber"], qty: "a handful", optional: true } },
    steps: (p) => [`Put ${p.carb}, ${p.protein} and ${p.fruit}${p.veg ? ` and ${p.veg}` : ""} in separate spots of a container.`, "Keep it cold until snack time."],
    kidTip: "Pick one thing of each color.",
  },
  {
    id: "hummus_cups", meals: ["snack"], days: TRAIN, minutes: 5, serves: 1, equipment: [],
    title: (p) => `${cap(p.dip)} veggie cup`,
    slots: { dip: { ids: ["hummus", "greek_yogurt", "lf_yogurt"], qty: "3 tbsp" }, veg: { ids: ["carrots", "cucumber", "peppers"], qty: "a handful" }, crunch: { ids: ["pretzels", "crackers", "rice_cakes"], qty: "a few", optional: true } },
    steps: (p) => [`Spoon ${p.dip} into the bottom of a cup.`, `Stand ${p.veg}${p.crunch ? ` and ${p.crunch}` : ""} up in the dip.`],
  },
  {
    id: "wrap", meals: ["lunch"], days: ALL, minutes: 5, serves: 1, equipment: [],
    title: (p) => `${cap(p.protein)} wrap`,
    slots: { wrap: { ids: [...WRAP, "gf_toast"], qty: "1 large" }, protein: { ids: ["turkey", "chicken", "hummus"], qty: "3 to 4 oz" }, veg: { ids: ["greens", "cucumber", "tomato", "carrots"], qty: "a handful" }, cheese: { ids: ["cheese"], qty: "1 slice", optional: true }, fruit: { ids: ["apple", "grapes", "orange", "banana"], qty: "1 serving" } },
    steps: (p) => [`Lay out ${p.wrap}.`, `Add ${p.protein}${p.cheese ? `, ${p.cheese}` : ""} and ${p.veg}.`, "Fold in the sides and roll it up.", `Pack ${p.fruit} on the side. Easy school lunch.`],
  },
  {
    id: "yogurt_bark", meals: ["snack", "recovery"], days: TRAIN, minutes: 10, serves: 4, equipment: ["freezer"],
    title: () => "Frozen yogurt bark",
    slots: { yog: { ids: YOGURT, qty: "2 cups" }, fruit: { ids: ["berries", "banana"], qty: "1 cup" }, sweet: { ids: ["honey", "maple"], qty: "1 tbsp", optional: true } },
    steps: (p) => ["Line a tray with parchment paper.", `Spread ${p.yog} on it about half an inch thick.`, `Press ${p.fruit} on top${p.sweet ? ` and drizzle with ${p.sweet}` : ""}.`, ["Freeze 2 hours, then break into pieces.", "freezer"]],
    kidTip: "Great on hot days. Keep pieces in a freezer bag.",
  },
  // ---- small appliances (junior chefs on their own) ------------------------
  {
    id: "power_toast", meals: ["breakfast", "snack"], days: ["match", "match_eve", "training"], minutes: 5, serves: 1, equipment: ["toaster"],
    title: (p) => `Power ${bare(p.bread)}`,
    slots: { bread: { ids: ["toast", "gf_toast", "rice_cakes"], qty: "2 slices" }, spread: { ids: [...SPREAD, "jam"], qty: "1 tbsp" }, top: { ids: ["banana", "berries"], qty: "1/2" }, sweet: { ids: ["honey", "cinnamon"], qty: "a sprinkle", optional: true } },
    steps: (p) => [[`Put the ${bare(p.bread)} in the toaster.`, "toaster"], `Spread ${p.spread} on top.`, `Add ${p.top}${p.sweet ? ` and ${p.sweet}` : ""}.`],
    kidTip: "Best 2 to 3 hours before a game.",
  },
  {
    id: "microwave_oats", meals: ["breakfast"], days: ALL, minutes: 5, serves: 1, equipment: ["microwave"],
    title: () => "Microwave oatmeal",
    slots: { oats: { ids: ["oats"], qty: "1/2 cup" }, milk: { ids: MILKS, qty: "1 cup" }, fruit: { ids: ["banana", "berries"], qty: "1/2 cup" }, top: { ids: ["cinnamon", "maple", "honey"], qty: "a sprinkle", optional: true } },
    steps: (p) => [`Stir ${p.oats} and ${p.milk} in a big microwave-safe bowl (it bubbles up).`, ["Microwave 2 minutes, stir, then 30 more seconds.", "microwave"], "Let it sit 1 minute. The bowl is hot: use a mitt.", `Top with ${p.fruit}${p.top ? ` and ${p.top}` : ""}.`],
  },
  {
    id: "mug_eggs", meals: ["breakfast", "recovery"], days: ALL, minutes: 5, serves: 1, equipment: ["microwave"],
    title: () => "Microwave mug eggs",
    slots: { eggs: { ids: ["eggs"], qty: "2" }, milk: { ids: MILKS, qty: "1 tbsp", optional: true }, cheese: { ids: ["cheese"], qty: "a pinch", optional: true }, side: { ids: ["toast", "gf_toast", "banana"], qty: "1 serving" } },
    steps: (p) => ["Spray a mug with oil.", `Crack in the eggs, add ${p.milk ? p.milk : "a splash of water"}, and beat with a fork.`, ["Microwave 45 seconds, stir, then 30 to 45 seconds more until set.", "microwave"], `${p.cheese ? `Top with ${p.cheese}. ` : ""}Serve with ${p.side}.`],
    kidTip: "Watch it through the window. Stop when it's puffed and set.",
  },
  {
    id: "smoothie", meals: ["breakfast", "snack", "recovery"], days: ALL, minutes: 5, serves: 1, equipment: ["blender"],
    title: () => "Recovery smoothie",
    slots: { milk: { ids: MILKS, qty: "1 cup" }, fruit: { ids: ["banana", "berries"], qty: "1 cup" }, yog: { ids: YOGURT, qty: "1/2 cup", optional: true }, oats: { ids: ["oats"], qty: "1/4 cup", optional: true }, nut: { ids: SPREAD, qty: "1 tbsp", optional: true } },
    steps: (p) => [`Put ${p.milk}, ${p.fruit}${p.yog ? `, ${p.yog}` : ""}${p.oats ? `, ${p.oats}` : ""}${p.nut ? ` and ${p.nut}` : ""} in the blender with a few ice cubes.`, ["Lid on tight, then blend until smooth.", "blender"], "Drink within an hour after training."],
  },
  {
    id: "smoothie_pops", meals: ["snack"], days: TRAIN, minutes: 10, serves: 6, equipment: ["blender", "freezer"],
    title: () => "Smoothie pops",
    slots: { fruit: { ids: ["berries", "banana", "watermelon"], qty: "2 cups" }, yog: { ids: [...YOGURT, "soy_milk"], qty: "1 cup" }, sweet: { ids: ["honey", "maple"], qty: "1 tbsp", optional: true } },
    steps: (p) => [[`Blend ${p.fruit} and ${p.yog}${p.sweet ? ` with ${p.sweet}` : ""}.`, "blender"], "Pour into ice-pop molds or small cups with a stick.", ["Freeze 4 hours.", "freezer"]],
    kidTip: "A cold treat after a hot practice.",
  },
  {
    id: "baked_potato", meals: ["lunch", "dinner", "recovery"], days: TRAIN, minutes: 12, serves: 1, equipment: ["microwave"],
    title: (p) => `Stuffed ${p.base.replace(/es$/, "")} with ${p.protein}`,
    slots: { base: { ids: ["sweet_potato", "potato"], qty: "1 large" }, protein: { ids: ["beans", "chicken", "turkey", "tofu"], qty: "a palm-size portion" }, top: { ids: ["greek_yogurt", "lf_yogurt", "cheese"], qty: "2 tbsp", optional: true }, veg: { ids: ["greens", "peppers", "tomato"], qty: "1 cup" } },
    steps: (p) => [`Poke the ${bare(p.base)} with a fork a few times.`, ["Microwave 5 minutes, turn it over, then 3 to 5 more until soft.", "microwave"], "Let it cool 2 minutes. Use a mitt.", `Split it and fill with ${p.protein} and ${p.veg}${p.top ? `, then top with ${p.top}` : ""}.`],
  },
  {
    id: "quesadilla", meals: ["lunch", "snack"], days: TRAIN, minutes: 8, serves: 1, equipment: ["microwave"],
    title: (p) => `${cap(p.protein)} quesadilla`,
    slots: { wrap: { ids: WRAP, qty: "2" }, cheese: { ids: ["cheese"], qty: "1/3 cup" }, protein: { ids: ["chicken", "beans", "turkey"], qty: "1/3 cup" }, veg: { ids: ["peppers", "greens", "tomato"], qty: "a handful", optional: true } },
    steps: (p) => [`Put ${p.cheese}, ${p.protein}${p.veg ? ` and ${p.veg}` : ""} on one ${bare(p.wrap).replace(/s$/, "")}. Top with the other.`, ["Microwave 45 to 60 seconds until the cheese melts.", "microwave"], "Let it cool a minute, then cut into wedges."],
  },
  // ---- stove, oven, knives (home cooks; younger kids cook together) --------
  {
    id: "breakfast_toast", meals: ["breakfast"], days: ALL, minutes: 10, serves: 1, equipment: ["stove", "toaster"],
    title: (p) => `Scrambled eggs on ${p.toast}`,
    slots: { eggs: { ids: ["eggs"], qty: "2 to 3" }, toast: { ids: ["toast", "gf_toast"], qty: "2 slices" }, fat: { ids: ["butter", ...FAT], qty: "1 tsp" }, fruit: { ids: ["orange", "berries", "banana"], qty: "1 serving" } },
    steps: (p) => ["Crack the eggs into a bowl and whisk with a fork.", [`Melt ${p.fat} in a pan on low heat, add eggs, and stir slowly until just set.`, "stove"], [`Put the ${bare(p.toast)} in the toaster.`, "toaster"], `Serve with ${p.fruit}.`],
  },
  {
    id: "pancakes", meals: ["breakfast"], days: ["match_eve", "rest", "recovery", "match"], minutes: 20, serves: 3, equipment: ["stove"],
    title: () => "Banana pancakes",
    slots: { flour: { ids: ["flour", "gf_flour"], qty: "1 cup" }, milk: { ids: MILKS, qty: "3/4 cup" }, banana: { ids: ["banana"], qty: "1 mashed" }, eggs: { ids: ["eggs"], qty: "1", optional: true }, top: { ids: ["maple", "honey", "berries"], qty: "to taste" } },
    steps: (p) => [`Mash the banana, then mix in ${p.flour}, ${p.milk}${p.eggs ? " and an egg" : ""} and 1 tsp baking powder.`, ["Heat a lightly oiled pan on medium. Pour small circles of batter.", "stove"], ["Flip when bubbles pop on top, about 2 minutes a side.", "stove"], `Top with ${p.top}. Great 3+ hours before a game.`],
    kidTip: "Kids can mash, measure and stir. A grown-up flips.",
  },
  {
    id: "rice_bowl", meals: ["lunch", "dinner", "recovery"], days: ALL, minutes: 25, serves: 2, equipment: ["stove", "knife"],
    title: (p) => `${cap(p.protein)} rice bowl`,
    slots: { rice: { ids: ["rice", "quinoa"], qty: "1 to 2 cups cooked" }, protein: { ids: PROTEIN, qty: "a palm-size portion" }, veg: { ids: ["carrots", "cucumber", "peppers", "greens"], qty: "1 cup" }, sauce: { ids: SOY, qty: "1 tbsp", optional: true }, fat: { ids: FAT, qty: "1 tsp" } },
    steps: (p) => [[`Cook the ${p.rice} on the stove (or use microwave rice cups).`, "stove"], [`Cook ${p.protein} in ${p.fat} until done, then slice it.`, "stove"], [`Slice ${p.veg}.`, "knife"], `Pile it all in a bowl${p.sauce ? ` with a splash of ${p.sauce}` : ""}.`],
  },
  {
    id: "egg_fried_rice", meals: ["lunch", "dinner"], days: TRAIN, minutes: 15, serves: 2, equipment: ["stove"],
    title: () => "Egg fried rice",
    slots: { rice: { ids: ["rice"], qty: "2 cups cooked (day-old is best)" }, eggs: { ids: ["eggs"], qty: "2" }, veg: { ids: ["peppers", "carrots", "greens"], qty: "1 cup" }, sauce: { ids: SOY, qty: "1 tbsp" }, fat: { ids: FAT, qty: "1 tbsp" }, extra: { ids: ["chicken", "tofu", "shrimp"], qty: "1/2 cup", optional: true } },
    steps: (p) => [[`Heat ${p.fat} in a big pan on medium-high. Add ${p.veg} and cook 2 minutes.`, "stove"], ["Push to the side, crack in the eggs, and scramble.", "stove"], [`Add the rice${p.extra ? ` and ${p.extra}` : ""} and ${p.sauce}. Stir until hot.`, "stove"]],
  },
  {
    id: "pasta_night", meals: ["dinner"], days: ["match_eve", "training", "rest", "recovery"], minutes: 25, serves: 3, equipment: ["stove"], batch: true,
    title: (p) => `${cap(p.pasta)} with ${p.protein} and tomato sauce`,
    slots: { pasta: { ids: PASTA, qty: "2 cups cooked per person" }, sauce: { ids: ["tomato_sauce"], qty: "3/4 cup" }, protein: { ids: ["turkey", "chicken", "beef", "tofu", "lentils"], qty: "a palm-size portion" }, cheese: { ids: ["parmesan"], qty: "a sprinkle", optional: true }, veg: { ids: ["greens", "peppers", "carrots"], qty: "1 cup" } },
    steps: (p) => [[`Boil the ${p.pasta}. Drain it carefully: the water is very hot.`, "stove"], [`Brown ${p.protein} and simmer it in ${p.sauce} for 10 minutes.`, "stove"], `Serve with ${p.veg} on the side${p.cheese ? ` and ${p.cheese} on top` : ""}. The classic night-before-game meal.`],
    kidTip: "Kids can measure, stir the sauce off the heat and set the table.",
  },
  {
    id: "pasta_salad", meals: ["lunch"], days: TRAIN, minutes: 20, serves: 3, equipment: ["stove", "knife"], batch: true,
    title: (p) => `Cold ${bare(p.pasta)} salad`,
    slots: { pasta: { ids: PASTA, qty: "3 cups cooked" }, veg: { ids: ["cucumber", "tomato", "peppers"], qty: "1.5 cups" }, fat: { ids: FAT, qty: "2 tbsp" }, lemon: { ids: ["lemon"], qty: "1/2", optional: true }, protein: { ids: ["chicken", "turkey", "cheese", "beans"], qty: "1 cup", optional: true } },
    steps: (p) => [[`Cook ${p.pasta}, rinse with cold water, and drain.`, "stove"], [`Chop ${p.veg}.`, "knife"], `Toss with ${p.fat}${p.lemon ? `, ${p.lemon} juice` : ""}, a pinch of salt${p.protein ? ` and ${p.protein}` : ""}.`, "Keeps 3 days in the fridge. Lunch for the week."],
  },
  {
    id: "tacos", meals: ["lunch", "dinner"], days: TRAIN, minutes: 20, serves: 3, equipment: ["stove", "knife"],
    title: (p) => `${cap(p.protein).replace(/s$/, "")} tacos`,
    slots: { shell: { ids: WRAP, qty: "3" }, protein: { ids: ["chicken", "turkey", "beef", "beans", "tofu"], qty: "a palm-size portion" }, veg: { ids: ["peppers", "tomato", "greens"], qty: "1 cup" }, cheese: { ids: ["cheese"], qty: "a small handful", optional: true }, side: { ids: ["rice"], qty: "1 cup cooked" } },
    steps: (p) => [[`Cook ${p.protein} in a pan with mild taco spices.`, "stove"], [`Chop ${p.veg}.`, "knife"], [`Warm the ${p.shell}.`, "stove"], `Fill with ${p.protein}${p.cheese ? `, ${p.veg} and ${p.cheese}` : ` and ${p.veg}`}. Serve with ${p.side}.`],
    kidTip: "Taco night: kids build their own.",
  },
  {
    id: "burrito_bowls", meals: ["lunch", "dinner"], days: ALL, minutes: 40, serves: 4, equipment: ["stove", "knife"], batch: true,
    title: (p) => `${cap(p.protein)} burrito bowls for the week`,
    slots: { rice: { ids: ["rice", "quinoa"], qty: "2 cups dry" }, protein: { ids: ["chicken", "turkey", "tofu", "beans"], qty: "1.5 lb" }, veg: { ids: ["peppers", "tomato", "greens"], qty: "3 cups" }, fat: { ids: FAT, qty: "1 tbsp" } },
    steps: (p) => [[`Cook the ${p.rice}.`, "stove"], [`Cook ${p.protein} in ${p.fat} with mild taco spices.`, "stove"], [`Chop ${p.veg}.`, "knife"], "Split into 4 containers. Lunch or dinner for 4 days."],
  },
  {
    id: "turkey_burgers", meals: ["dinner"], days: TRAIN, minutes: 25, serves: 4, equipment: ["stove", "oven"],
    title: (p) => `${cap(p.protein)} burgers with ${bare(p.side).replace(/es$/, "")} wedges`,
    slots: { protein: { ids: ["turkey", "beef", "chicken"], qty: "1 lb ground" }, side: { ids: ["sweet_potato", "potato"], qty: "2 large" }, bread: { ids: ["toast", "gf_toast"], qty: "1 per burger", optional: true }, fat: { ids: FAT, qty: "1 tbsp" }, veg: { ids: ["greens", "tomato"], qty: "for topping" } },
    steps: (p) => [[`Cut ${p.side} into wedges, toss with ${p.fat} and salt, and bake at 425°F for 25 minutes.`, "oven"], `Shape ${p.protein} into 4 patties.`, [`Cook in a pan on medium, 5 to 6 minutes a side, until no pink in the middle (165°F).`, "stove"], `Serve${p.bread ? ` on ${p.bread}` : ""} with ${p.veg}.`],
    kidTip: "Kids shape the patties with clean hands, then wash up.",
  },
  {
    id: "sheet_pan", meals: ["dinner", "recovery"], days: TRAIN, minutes: 30, serves: 2, equipment: ["oven", "knife"],
    title: (p) => `Baked ${p.protein} with ${p.carb}`,
    slots: { protein: { ids: ["salmon", "chicken", "tofu"], qty: "a palm-size portion each" }, carb: { ids: ["sweet_potato", "potato", "rice"], qty: "1 large or 1.5 cups" }, veg: { ids: ["broccoli", "greens", "carrots"], qty: "1 cup" }, fat: { ids: FAT, qty: "1 tbsp" }, lemon: { ids: ["lemon"], qty: "1 wedge", optional: true } },
    steps: (p) => [[`Heat the oven to 400°F. Cut ${p.carb} into chunks.`, "knife"], [`Roast ${p.carb} in ${p.fat} for 20 minutes.`, "oven"], [`Add ${p.protein} and ${p.veg} for the last 12 to 15 minutes${p.lemon ? `, then squeeze ${p.lemon} on top` : ""}.`, "oven"]],
  },
  {
    id: "oat_tenders", meals: ["dinner", "lunch"], days: TRAIN, minutes: 30, serves: 3, equipment: ["oven"],
    title: () => "Crispy oat chicken tenders",
    slots: { protein: { ids: ["chicken"], qty: "1 lb tenders" }, crumb: { ids: ["oats", "rice_cakes"], qty: "1 cup, crushed" }, bind: { ids: ["eggs", "greek_yogurt", "olive_oil"], qty: "to coat" }, side: { ids: ["sweet_potato", "potato", "rice"], qty: "1 serving each" }, veg: { ids: ["carrots", "broccoli", "cucumber"], qty: "1 cup" } },
    steps: (p) => [`Crush ${p.crumb} in a bag with salt and mild spices.`, `Coat each tender in ${p.bind}, then in the crumbs.`, ["Bake at 425°F on an oiled tray, 15 to 18 minutes, until no pink inside (165°F).", "oven"], `Serve with ${p.side} and ${p.veg}.`],
    kidTip: "Kids do the shaking and coating. A grown-up handles the oven.",
  },
  {
    id: "stir_fry", meals: ["dinner"], days: TRAIN, minutes: 20, serves: 2, equipment: ["stove", "knife"],
    title: (p) => `${cap(p.protein)} stir-fry`,
    slots: { protein: { ids: ["chicken", "tofu", "shrimp", "beef"], qty: "a palm-size portion" }, veg: { ids: ["peppers", "broccoli", "carrots"], qty: "2 cups" }, sauce: { ids: SOY, qty: "2 tbsp" }, carb: { ids: ["rice", "pasta", "gf_pasta"], qty: "1.5 cups cooked" }, fat: { ids: FAT, qty: "1 tbsp" } },
    steps: (p) => [[`Cook ${p.carb}.`, "stove"], [`Slice ${p.protein} and ${p.veg}.`, "knife"], [`Stir-fry ${p.protein} in ${p.fat} on high heat, then add ${p.veg}.`, "stove"], `Add ${p.sauce}, toss, and serve over ${p.carb}.`],
  },
  {
    id: "soup", meals: ["lunch", "dinner"], days: ALL, minutes: 30, serves: 4, equipment: ["stove"], batch: true,
    title: (p) => `${cap(p.protein)} and ${bare(p.carb)} soup`,
    slots: { protein: { ids: ["chicken", "turkey", "tofu", "lentils"], qty: "a palm-size portion" }, carb: { ids: ["rice", "pasta", "gf_pasta", "potato"], qty: "1 cup" }, veg: { ids: ["carrots", "greens"], qty: "1 cup" }, broth: { ids: ["broth"], qty: "4 cups" } },
    steps: (p) => [[`Simmer ${p.broth} with ${p.veg}.`, "stove"], [`Add ${p.protein} and ${p.carb} and cook until done, about 15 minutes.`, "stove"], "Great on cold days and when appetite is low. Freezes well."],
  },
];

// ---------------------------------------------------------------------------
// Vendor placements (built, off by default)
// ---------------------------------------------------------------------------

export interface VendorProduct extends FoodTags {
  id: string;
  brand: string;
  product: string;
  /** Catalog id this product can stand in for, e.g. "pasta". */
  replaces: string;
  url?: string;
  active: boolean;
  start?: string;
  end?: string;
}

export const vendorsEnabled = () => process.env.VENDOR_PLACEMENTS === "on";

// ---------------------------------------------------------------------------
// Building, filtering, age modes
// ---------------------------------------------------------------------------

export interface RecipeStep { text: string; who: "you" | "grown-up"; uses?: Equip }
export interface Recipe {
  id: string;
  name: string;
  meals: Meal[];
  minutes: number;
  serves: number;
  equipment: Equip[];
  level: 1 | 2 | 3;
  /** How this player makes it: on their own, together with a grown-up, or the parent cooks. */
  mode: Who;
  label: string;
  batch: boolean;
  ingredients: { name: string; qty: string; sponsored?: { brand: string; product: string; url?: string } }[];
  steps: RecipeStep[];
  swaps: string[];
  kidTip?: string;
}

export interface RecipeFilter {
  /** Equipment the family has. Omit to allow everything. */
  have?: Equip[];
  maxMinutes?: number;
  meal?: Meal;
  who?: Who;
  batch?: boolean;
}

const levelOf = (eq: Equip[]): 1 | 2 | 3 => eq.reduce<number>((m, e) => Math.max(m, LEVEL[e]), 1) as 1 | 2 | 3;
const labelOf = (eq: Equip[]) => (eq.length === 0 ? "No-cook" : eq.includes("oven") ? "Oven" : eq.includes("stove") ? "Stovetop" : eq.includes("microwave") ? "Microwave" : eq.includes("toaster") ? "Toaster" : eq.includes("blender") ? "Blender" : "Freezer");

function build(def: RecipeDef, c: SafetyContext, cook: CookProfile, who: Who, avoidHeavy = false, vendors: VendorProduct[] = [], today?: string): Recipe | null {
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
    const ing: Recipe["ingredients"][number] = { name: chosen.name, qty: slot.qty };
    // Paid placement: only when switched on, in date, and safe for this player.
    if (vendors.length && vendorsEnabled()) {
      const v = vendors.find((x) => x.active && x.replaces === chosen.id && (!x.start || !today || x.start <= today) && (!x.end || !today || x.end >= today) && !unsafeReason({ ...x, name: `${x.brand} ${x.product}`.toLowerCase(), keywords: [...(chosen.keywords || []), x.product.toLowerCase()] }, c));
      if (v) ing.sponsored = { brand: v.brand, product: v.product, url: v.url };
    }
    ingredients.push(ing);
  }
  const level = levelOf(def.equipment);
  // Anything within the player's level is theirs to make; harder recipes become "cook together".
  const mode: Who = who === "parent" ? "parent" : level <= cook.aloneMax ? "alone" : "together";
  const steps: RecipeStep[] = def.steps(picks).map((s) => {
    const [text, uses] = typeof s === "string" ? [s, undefined] : s;
    const needsAdult = mode === "together" && uses !== undefined && LEVEL[uses] > cook.aloneMax;
    return { text, uses, who: mode === "parent" ? "grown-up" : needsAdult ? "grown-up" : "you" };
  });
  return {
    id: def.id, name: def.title(picks), meals: def.meals, minutes: def.minutes, serves: def.serves, equipment: def.equipment,
    level, mode, label: labelOf(def.equipment), batch: !!def.batch, ingredients, steps, swaps,
    kidTip: cook.id === "little" || cook.id === "junior" ? def.kidTip : undefined,
  };
}

function passes(def: RecipeDef, f: RecipeFilter, cook: CookProfile): boolean {
  if (f.have && !def.equipment.every((e) => f.have!.includes(e))) return false;
  if (f.maxMinutes && def.minutes > f.maxMinutes) return false;
  if (f.meal && !def.meals.includes(f.meal)) return false;
  if (f.batch && !def.batch) return false;
  if (f.who === "alone" && levelOf(def.equipment) > cook.aloneMax) return false;
  return true;
}

export interface RecipeBook {
  cook: CookProfile;
  who: Who;
  filter: RecipeFilter;
  recipes: Recipe[];
  /** How many recipes each piece of equipment unlocks (for the picker). */
  unlocks: Partial<Record<Equip, number>>;
  counts: { alone: number; together: number; total: number };
}

/** Every recipe that fits this player's food rules, age and kitchen. */
export function recipeBook(profile: AthleteProfile, f: RecipeFilter = {}, opts: { vendors?: VendorProduct[]; today?: string; gameDay?: boolean } = {}): RecipeBook {
  const cook = cookProfile(effectiveAge(profile.identity));
  const who = f.who || cook.defaultWho;
  const c = safetyContext(profile, { gameDay: opts.gameDay });
  const safeDefs = RECIPES.filter((d) => build(d, c, cook, who) !== null && (d.minAge === undefined || (effectiveAge(profile.identity) ?? 99) >= d.minAge));
  const recipes = safeDefs.filter((d) => passes(d, { ...f, who }, cook)).map((d) => build(d, c, cook, who, !!opts.gameDay, opts.vendors, opts.today)!)
    .sort((a, b) => a.level - b.level || a.minutes - b.minutes);
  const unlocks: RecipeBook["unlocks"] = {};
  for (const e of EQUIPMENT) unlocks[e] = safeDefs.filter((d) => d.equipment.includes(e)).length;
  return {
    cook, who, filter: f, recipes, unlocks,
    counts: { alone: safeDefs.filter((d) => levelOf(d.equipment) <= cook.aloneMax).length, together: safeDefs.length, total: RECIPES.length },
  };
}

/** Internal: defs + builder for the weekly meal plan. */
export function planCandidates(profile: AthleteProfile, meal: Meal, gameDay: boolean, f: RecipeFilter = {}) {
  const cook = cookProfile(effectiveAge(profile.identity));
  const who = f.who || cook.defaultWho;
  const c = safetyContext(profile, { gameDay });
  const age = effectiveAge(profile.identity) ?? 99;
  return RECIPES
    .filter((d) => d.meals.includes(meal) && (d.minAge === undefined || age >= d.minAge) && passes(d, { ...f, who: f.who }, cook))
    .map((d) => ({ id: d.id, days: d.days, r: build(d, c, cook, who, gameDay) }))
    .filter((x): x is { id: string; days: DayType[]; r: Recipe } => !!x.r);
}
