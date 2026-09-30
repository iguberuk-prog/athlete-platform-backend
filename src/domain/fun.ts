/**
 * Fun layer (pure). Everything here rewards habits, never body size.
 *
 *   Kids 12 and under: fuel buddy, sticker book, game-day bedtime story
 *   Teens 13+:         pre-game playlist plan, season wrapped
 *   Everyone:          family cook night, grocery scavenger hunt, car ride quiz
 */

import type { AthleteProfile } from "./profile.js";
import type { DailyCheckIn } from "./checkin.js";
import { effectiveAge } from "./profile.js";
import { sleepHoursFor } from "./ageBands.js";
import { shortDate } from "./dates.js";
import { FOODS, examples, food, isSafe, safetyContext } from "./foods.js";
import { cookProfile, recipeBook, type Recipe } from "./recipes.js";
import type { NextUp } from "./dayplans.js";
import type { GameLog } from "./journal.js";
import { seasonStats, whatWorked } from "./journal.js";
import type { Progress } from "./progress.js";
import type { AisleSection } from "./grocery.js";

const first = (p: AthleteProfile) => (p.identity.fullName || "").trim().split(/\s+/)[0] || "Champ";

// ---------------------------------------------------------------------------
// Fuel buddy
// ---------------------------------------------------------------------------

export const BUDDY_COLORS = ["lime", "sky", "orange", "purple", "red", "gold", "teal", "pink"] as const;
export type BuddyColor = (typeof BUDDY_COLORS)[number];

export interface Buddy {
  name: string;
  color: BuddyColor;
  /** 0-100 for today: water, sleep, check-in, warm-up. */
  energy: number;
  mood: "super" | "happy" | "okay" | "thirsty" | "sleepy" | "waiting";
  say: string;
  level: number;
  /** Jersey colors unlocked by filling sticker pages. */
  jerseys: BuddyColor[];
  todo: { id: string; text: string; done: boolean }[];
}

export function fuelBuddy(profile: AthleteProfile, today: string, checkins: DailyCheckIn[], stickers: StickerBook): Buddy {
  const fun = profile.fun || {};
  const name = fun.buddyName || "Kicks";
  const color = (BUDDY_COLORS as readonly string[]).includes(fun.buddyColor || "") ? (fun.buddyColor as BuddyColor) : "lime";
  const ci = checkins.find((c) => c.date === today);
  const [sleepMin] = sleepHoursFor(effectiveAge(profile.identity));
  const water = !!ci && (ci.urineColor !== undefined ? ci.urineColor <= 3 : (ci.hydrationLevel ?? 0) >= 7);
  const slept = !!ci && (ci.sleepHoursLastNight ?? 0) >= sleepMin;
  const todo = [
    { id: "checkin", text: `Tell ${name} how you feel (check in)`, done: !!ci },
    { id: "water", text: "Drink water and fill your bottle", done: water },
    { id: "sleep", text: `Sleep ${sleepMin}+ hours`, done: slept },
    { id: "warmup", text: "Do your warm-up", done: !!ci?.warmupDone },
  ];
  const energy = Math.round((todo.filter((t) => t.done).length / todo.length) * 100);
  const mood: Buddy["mood"] = !ci ? "waiting" : energy === 100 ? "super" : !water && ci ? "thirsty" : !slept ? "sleepy" : energy >= 50 ? "happy" : "okay";
  const SAY: Record<Buddy["mood"], string> = {
    waiting: `Hi ${first(profile)}! How are you feeling today?`,
    super: "Full power! We're ready for anything!",
    happy: "Feeling good! One more thing and we're at full power.",
    okay: "Let's power up together. Check the list!",
    thirsty: "I'm thirsty! Let's drink some water.",
    sleepy: "Yawn... let's get to bed early tonight.",
  };
  const pages = Math.floor(stickers.total / stickers.perPage);
  return { name, color, energy, mood, say: SAY[mood], level: 1 + Math.floor(stickers.total / 5), jerseys: BUDDY_COLORS.slice(0, Math.min(BUDDY_COLORS.length, 1 + pages)) as BuddyColor[], todo };
}

// ---------------------------------------------------------------------------
// Sticker book
// ---------------------------------------------------------------------------

export interface Sticker { id: string; date: string; kind: "checkin" | "water" | "sleep" | "warmup" | "chef" | "quiz" | "story" | "breathe"; label: string }
export interface StickerBook { stickers: Sticker[]; total: number; perPage: number; pages: Sticker[][]; newToday: Sticker[] }

const STICKER_LABEL: Record<Sticker["kind"], string> = {
  checkin: "Check-in star", water: "Water hero", sleep: "Sleep champ", warmup: "Brave warm-up", chef: "Chef hat", quiz: "Quiz whiz", story: "Story time", breathe: "Calm cloud",
};

export function stickerBook(profile: AthleteProfile, checkins: DailyCheckIn[], events: { kind: Sticker["kind"]; date: string }[], today: string): StickerBook {
  const [sleepMin] = sleepHoursFor(effectiveAge(profile.identity));
  const out: Sticker[] = [];
  const add = (kind: Sticker["kind"], date: string) => out.push({ id: `${kind}:${date}`, kind, date, label: STICKER_LABEL[kind] });
  for (const c of [...checkins].filter((x) => x.date <= today).sort((a, b) => a.date.localeCompare(b.date))) {
    add("checkin", c.date);
    if (c.urineColor !== undefined ? c.urineColor <= 3 : (c.hydrationLevel ?? 0) >= 7) add("water", c.date);
    if ((c.sleepHoursLastNight ?? 0) >= sleepMin) add("sleep", c.date);
    if (c.warmupDone) add("warmup", c.date);
    if (c.breathingDone) add("breathe", c.date);
  }
  const seen = new Set(out.map((s) => s.id));
  for (const e of events) { const id = `${e.kind}:${e.date}`; if (!seen.has(id) && e.date <= today) { seen.add(id); add(e.kind, e.date); } }
  out.sort((a, b) => a.date.localeCompare(b.date));
  const perPage = 12;
  const pages: Sticker[][] = [];
  for (let i = 0; i < out.length; i += perPage) pages.push(out.slice(i, i + perPage));
  return { stickers: out, total: out.length, perPage, pages, newToday: out.filter((s) => s.date === today) };
}

// ---------------------------------------------------------------------------
// Game-day bedtime story (night before a game, kids 12 and under)
// ---------------------------------------------------------------------------

export function gameDayStory(profile: AthleteProfile, next: NextUp | null, buddyName: string): { title: string; paragraphs: string[] } | null {
  if (!next || next.type === "training") return null;
  const name = first(profile);
  const c = safetyContext(profile, { gameDay: true });
  const breakfast = examples(c, ["oats", "banana", "toast", "greek_yogurt", "rice_cakes"], 2, "breakfast", "a breakfast you like");
  const half = examples(c, ["orange", "banana", "grapes"], 1, "halftime", "a piece of fruit");
  const after = examples(c, ["choc_milk", "greek_yogurt", "banana", "rice_cakes"], 1, "recovery", "a yummy snack");
  const tomorrow = next.minutesAway > 12 * 60 ? `on ${shortDate(next.date)}` : "tomorrow";
  return {
    title: `${name} and ${buddyName} get ready for the big game`,
    paragraphs: [
      `Once upon a time, the night before the big game, ${name} and ${buddyName} the soccer ball were getting ready for bed.`,
      `"We have a game ${tomorrow} at ${next.time}," said ${buddyName}. "Let's pack our bag so we're not in a rush." Together they packed the shin guards, the cleats, the jersey and a full water bottle. ${buddyName} checked everything twice.`,
      `"Now the most important part," whispered ${buddyName}. "Sleep. That's when our legs get stronger." ${name} turned off the lights and took three slow balloon breaths. In, and out. In, and out. In, and out.`,
      `In the morning, ${name} ate ${breakfast}, and ${buddyName} bounced with joy. "Fuel for running!" At the field, they did the warm-up with the whole team: jumping, skipping and quick feet.`,
      `At half-time, ${name} had ${half} and big gulps of water. And when the whistle blew at the end, win or lose, ${name} high-fived every teammate and shared ${after} with ${buddyName}.`,
      `"You played with your whole heart," said ${buddyName}. "That's what champions do." The end. Now, sweet dreams, ${name}.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Pre-game playlist plan (13+): phases timed from the countdown
// ---------------------------------------------------------------------------

export const PLAYLIST_GENRES = ["pop", "hip-hop", "latin", "edm", "rock", "country", "afrobeats", "k-pop", "r-n-b", "indie"] as const;

export interface PlaylistPhase { id: "calm" | "focus" | "hype"; label: string; minutes: number; mood: string; tempo: string; searchTerms: string[] }

export function playlistPlan(next: NextUp | null, genres: string[]): { title: string; phases: PlaylistPhase[]; totalMinutes: number } {
  const g = genres.filter((x) => (PLAYLIST_GENRES as readonly string[]).includes(x)).slice(0, 3);
  const gg = g.length ? g : ["pop", "hip-hop"];
  const phases: PlaylistPhase[] = [
    { id: "calm", label: "Pre-game meal", minutes: 30, mood: "calm and easy", tempo: "slow", searchTerms: gg.map((x) => `chill ${x}`) },
    { id: "focus", label: "On the way", minutes: 25, mood: "locked in", tempo: "medium", searchTerms: gg.map((x) => `focus ${x}`) },
    { id: "hype", label: "Warm-up", minutes: 20, mood: "hype", tempo: "fast", searchTerms: gg.map((x) => `workout ${x}`) },
  ];
  return { title: next ? `Game day: ${next.title} ${next.time}` : "Game day", phases, totalMinutes: phases.reduce((a, p) => a + p.minutes, 0) };
}

// ---------------------------------------------------------------------------
// Season wrapped (13+)
// ---------------------------------------------------------------------------

export interface WrappedSlide { id: string; big: string; small: string; line: string }

export function seasonWrapped(profile: AthleteProfile, checkins: DailyCheckIn[], logs: GameLog[], progress: Progress, from: string, to: string, extras: { cookNights: number; kitchenEntries: number }): { title: string; slides: WrappedSlide[]; shareText: string } {
  const cis = checkins.filter((c) => c.date >= from && c.date <= to);
  const sleepHours = Math.round(cis.reduce((a, c) => a + (c.sleepHoursLastNight || 0), 0));
  const hydrated = cis.filter((c) => (c.urineColor !== undefined ? c.urineColor <= 3 : (c.hydrationLevel ?? 0) >= 7)).length;
  const warm = cis.filter((c) => c.warmupDone).length;
  const st = seasonStats(logs, from, to);
  const insight = whatWorked(profile, logs.filter((l) => l.date >= from && l.date <= to), checkins).insights[0];
  const best = progress.streaks.find((s) => s.id === "checkin")?.best || 0;
  const badges = progress.badges.filter((b) => b.earned);
  const word = warm >= 30 ? "Built to last" : best >= 30 ? "Unstoppable" : sleepHours / Math.max(1, cis.length) >= 9 ? "Well rested" : st.goals >= 10 ? "Finisher" : cis.length >= 60 ? "Consistent" : "Just getting started";
  const slides: WrappedSlide[] = [
    { id: "intro", big: `${first(profile)}'s season`, small: `${shortDate(from)} to ${shortDate(to)}`, line: "Here's how you showed up." },
    { id: "checkins", big: `${cis.length}`, small: "check-ins", line: best ? `Longest streak: ${best} days in a row.` : "Every check-in makes your plan smarter." },
    { id: "sleep", big: `${sleepHours.toLocaleString()}`, small: "hours of sleep logged", line: "That's where your muscles grew back stronger." },
    { id: "water", big: `${hydrated}`, small: "well-hydrated days", line: "Your legs noticed." },
    { id: "warmup", big: `${warm}`, small: "injury-prevention warm-ups", line: "Every one of them protects your knees and ankles." },
    ...(st.games ? [{ id: "games", big: `${st.games}`, small: `games · ${st.minutes.toLocaleString()} minutes`, line: st.goals || st.assists ? `${st.goals} goals, ${st.assists} assists.` : st.saves ? `${st.saves} saves.` : "Every minute counted." }] : []),
    ...(insight ? [{ id: "worked", big: "What worked", small: "", line: insight.text }] : []),
    ...(extras.cookNights || extras.kitchenEntries ? [{ id: "kitchen", big: `${extras.cookNights + extras.kitchenEntries}`, small: "meals cooked", line: "Chef mode: on." }] : []),
    { id: "badges", big: `${badges.length}`, small: "badges earned", line: badges.slice(-3).map((b) => b.name).join(", ") || "Next season's goal: your first badge." },
    { id: "word", big: word, small: "your season in two words", line: "See you next season." },
  ];
  const shareText = `My season: ${cis.length} check-ins, ${sleepHours} hours of sleep, ${warm} warm-ups${st.games ? `, ${st.games} games` : ""}. Season word: ${word}.`;
  return { title: `${first(profile)}'s season wrapped`, slides, shareText };
}

// ---------------------------------------------------------------------------
// Family cook night: one recipe that works for every player, jobs by age
// ---------------------------------------------------------------------------

export interface CookJob { who: string; age: number | null; title: string; jobs: string[] }
export interface CookNight { recipe: Recipe; jobs: CookJob[]; tips: string[] }

export function familyCookNight(players: AthleteProfile[], seed = 0): CookNight | null {
  if (!players.length) return null;
  // Oldest player's book as the base, then keep recipes that are safe for everyone.
  const books = players.map((p) => ({ p, ids: new Set(recipeBook(p, { who: "together" }).recipes.map((r) => r.id)) }));
  const oldest = [...players].sort((a, b) => (effectiveAge(b.identity) ?? 0) - (effectiveAge(a.identity) ?? 0))[0];
  // A shared recipe must pass every player's rules; build it for the strictest by checking each ingredient for all.
  const candidates = recipeBook(oldest, { who: "together" }).recipes
    .filter((r) => books.every((b) => b.ids.has(r.id)) && r.meals.includes("dinner") && r.minutes <= 40 && r.serves >= 2)
    .filter((r) => r.ingredients.every((i) => { const f = findFood(i.name); return !f || players.every((p) => isSafe(f, safetyContext(p))); }));
  if (!candidates.length) return null;
  const recipe = candidates[seed % candidates.length];
  const JOBS: Record<string, string[]> = {
    little: ["Wash the vegetables", "Measure and pour", "Stir cold ingredients", "Set the table"],
    junior: ["Read the recipe out loud", "Run the microwave or blender steps", "Mix and season", "Plate the food"],
    home: ["Cook on the stove", "Chop with a sharp knife (claw grip)", "Time each step"],
    cook: ["Head chef: run the stove and oven", "Chop and prep", "Taste and adjust"],
  };
  const jobs: CookJob[] = players.map((p) => {
    const cp = cookProfile(effectiveAge(p.identity));
    const pool = JOBS[cp.id].filter((j) => (recipe.equipment.includes("stove") || recipe.equipment.includes("oven") ? true : !/stove|oven/.test(j)));
    return { who: first(p), age: effectiveAge(p.identity) ?? null, title: cp.title, jobs: pool.slice(0, 2) };
  });
  const needsHeat = recipe.equipment.some((e) => e === "stove" || e === "oven" || e === "knife");
  if (needsHeat && !players.some((p) => (effectiveAge(p.identity) ?? 0) >= 16)) jobs.push({ who: "Grown-up", age: null, title: "Kitchen captain", jobs: ["Stove, oven and sharp knives", "Keep everyone safe"] });
  return { recipe, jobs, tips: ["Everyone washes hands first.", "Put on music and cook together. Clean up together too.", "Take a photo of the finished plate for the family album."] };
}

const CATALOG_BY_NAME = new Map(FOODS.map((f) => [f.name.toLowerCase(), f]));
/** Recipes carry display names; map back to catalog foods by exact name. */
const findFood = (name: string) => CATALOG_BY_NAME.get(name.toLowerCase());

// ---------------------------------------------------------------------------
// Grocery scavenger hunt
// ---------------------------------------------------------------------------

const AISLE_CLUE: Record<string, string> = {
  Produce: "Head to the colorful fruit and veggie section.",
  Bakery: "Follow the smell of fresh bread.",
  "Meat and seafood": "Go to the cold counter at the back.",
  Refrigerated: "Find the big fridges with glass doors.",
  Frozen: "Brrr! The freezer aisle.",
  Drinks: "Find the aisle full of bottles.",
  Pantry: "Search the shelves with boxes, bags and jars.",
  Other: "Ask a grown-up where this one lives.",
};

export function groceryHunt(aisles: AisleSection[]): { stops: { aisle: string; clue: string; items: { name: string; points: number; hint: string }[] }[]; maxPoints: number } {
  const stops = aisles.map((a) => ({
    aisle: a.aisle,
    clue: AISLE_CLUE[a.aisle] || AISLE_CLUE.Other,
    items: a.items.map((i) => {
      const n = i.name.toLowerCase();
      const hint = /banana|lemon|corn/.test(n) ? "Look for something yellow." : /berr|apple|tomato|pepper/.test(n) ? "Look for something red or blue." : /green|spinach|broccoli|cucumber/.test(n) ? "Look for something green." : /orange|carrot|sweet potato/.test(n) ? "Look for something orange." : "Check the labels!";
      return { name: i.name, points: /produce|fruit|veg/i.test(a.aisle) ? 15 : 10, hint };
    }),
  }));
  return { stops, maxPoints: stops.reduce((a, s) => a + s.items.reduce((b, i) => b + i.points, 0), 0) };
}

// ---------------------------------------------------------------------------
// Car ride quiz
// ---------------------------------------------------------------------------

export interface QuizQ { id: string; q: string; choices: string[]; answer: number; why: string; kids?: boolean }

/** Build 10 questions for this player. Food answers only use foods safe for them. */
export function carQuiz(profile: AthleteProfile, seed = 0): QuizQ[] {
  const age = effectiveAge(profile.identity) ?? 15;
  const kid = age < 13;
  const c = safetyContext(profile, { gameDay: true });
  const [sMin, sMax] = sleepHoursFor(age);
  const safe = (id: string) => { const f = food(id); return f && isSafe(f, c) ? f.name : null; };
  const halfSnack = safe("orange") || safe("banana") || safe("grapes") || safe("watermelon");
  const preCarb = safe("pasta") || safe("rice") || safe("gf_pasta") || safe("potato");
  const qs: QuizQ[] = [
    ...(halfSnack ? [{ id: "half", q: "What's a great half-time snack?", choices: [halfSnack, "a candy bar", "a big burger"], answer: 0, why: "Quick, easy carbs and water in the fruit. Heavy food sits in your stomach.", kids: true }] : []),
    { id: "water", q: "When should you drink water in a game?", choices: ["Only when you feel really thirsty", "At every break", "Never during games"], answer: 1, why: "Sip at every break. Thirst shows up late.", kids: true },
    { id: "sleep", q: `How many hours of sleep does ${kid ? "your body" : "someone your age"} need?`, choices: [`${sMin - 3}-${sMin - 2}`, `${sMin}-${sMax}`, `${sMax + 3}+`], answer: 1, why: `${sMin} to ${sMax} hours. That's when muscles repair.`, kids: true },
    { id: "pee", q: "What color pee means you're well hydrated?", choices: ["Pale yellow", "Dark yellow", "Orange"], answer: 0, why: "Pale yellow, like lemonade. Dark means drink up.", kids: true },
    { id: "warm", q: "Why do a warm-up before playing?", choices: ["It's boring, skip it", "It helps protect knees and ankles", "Only goalies need it"], answer: 1, why: "Warm-ups with balance and landing work cut injuries.", kids: true },
    ...(preCarb ? [{ id: "carb", q: "What's the best dinner the night before a game?", choices: [`${preCarb} with a lean protein`, "Fried food and soda", "Skip dinner"], answer: 0, why: "Carbs fill your energy tanks for tomorrow.", kids: true }] : []),
    { id: "after", q: "When should you eat after a game?", choices: ["Within an hour", "The next day", "It doesn't matter"], answer: 0, why: "Carbs and protein within an hour help you recover.", kids: true },
    { id: "hot", q: "It's very hot out. What should you add?", choices: ["More water and a sports drink", "A heavy sweatshirt", "Less water"], answer: 0, why: "Sweat takes water and salt. Replace both.", kids: true },
    { id: "head", q: "A teammate bumps heads and feels dizzy. What should happen?", choices: ["Keep playing", "Stop playing and tell a coach", "Drink water and go back in"], answer: 1, why: "Any hit with symptoms means stop for the day and get checked.", kids: true },
    { id: "cold", q: "It's cold out. What helps your body?", choices: ["A warm drink and a snack", "Skipping breakfast", "No gloves"], answer: 0, why: "Your body burns fuel to stay warm.", kids: true },
    ...(!kid ? [
      { id: "caffeine", q: "Energy drinks before a game are...", choices: ["A good idea for teens", "Not recommended under 18", "The same as water"], answer: 1, why: "Caffeine and stimulants can make your heart race, especially in heat." },
      { id: "protein", q: "About how much protein at each meal helps muscles recover?", choices: ["2 grams", "20 to 30 grams", "200 grams"], answer: 1, why: "About a palm-size portion, spread through the day." },
      { id: "fiber", q: "Why skip high-fiber, high-fat food right before a game?", choices: ["It's slow to digest", "It has too much water", "No reason"], answer: 0, why: "It can cause cramps and a heavy stomach while running." },
      { id: "rest", q: "How many full rest days a week should growing athletes get?", choices: ["None", "At least 1 to 2", "Only in summer"], answer: 1, why: "Rest days are when the body rebuilds." },
    ] : []),
  ];
  // Rotate so each ride feels different.
  const pool = kid ? qs.filter((q) => q.kids) : qs;
  const start = seed % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, 10);
}

