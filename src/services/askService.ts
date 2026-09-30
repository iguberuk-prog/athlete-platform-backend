/**
 * Ask the app: a sports-nutrition assistant that knows this player's age
 * program, food rules, schedule and today's plan.
 *
 * Safety layers:
 *   1. The system prompt lists the foods and ingredients the player must never
 *      be told to eat, plus the age rules (no caffeine or supplements for kids).
 *   2. Every answer is checked against the player's unsafe foods. If one slips
 *      in, we ask again once with a correction; if it still fails, the player
 *      gets a safe fallback instead.
 *   3. Medical, injury and mental-health questions get pointed to real people,
 *      and crisis language gets 988 right away.
 * Env: ANTHROPIC_API_KEY, optional ANTHROPIC_MODEL. 30 questions a day per account.
 */

import type { AthleteProfileRepository, CheckInRepository, RecordRepository } from "../data/repository.js";
import type { AthleteProfile } from "../domain/profile.js";
import { effectiveAge } from "../domain/profile.js";
import { FOODS, safetyContext, safetySummary, unsafeReason } from "../domain/foods.js";
import { buildProgram } from "../domain/program.js";
import { eventDate, eventTime, routineOf, sortedEvents, shortDate, to12 } from "../domain/dates.js";
import { dayWeatherPlan } from "../domain/weather.js";
import { positionFuel } from "../domain/daily.js";
import type { FamilyService } from "./familyService.js";
import type { WeatherProvider } from "../weather/nws.js";
import { loadWeather } from "./weatherService.js";

export interface ChatTurn { role: "user" | "assistant"; content: string }
export type AskResult = { ok: true; value: { answer: string; checked: boolean } } | { ok: false; code: "not_found" | "invalid" | "limit" | "not_configured" | "failed"; message?: string };

const ALLERGEN_WORDS: Record<string, RegExp> = {
  peanut: /peanut/i, tree_nut: /almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia/i, milk: /\bmilk\b|yogurt|cheese|whey|butter|cream|dairy/i,
  egg: /\beggs?\b|omelet/i, wheat: /pasta|bread|bagel|toast|pretzel|cracker|wheat|noodle|tortilla|pancake|waffle|cereal/i,
  gluten: /pasta|bread|bagel|toast|pretzel|cracker|wheat|noodle|barley|rye|pancake|waffle/i, soy: /\bsoy|tofu|edamame/i,
  fish: /salmon|tuna|\bfish\b|sardine|cod\b/i, shellfish: /shrimp|shellfish|crab|lobster/i, sesame: /sesame|tahini|hummus/i,
};
const CRISIS = /suicid|kill myself|end my life|self[- ]harm|hurt myself|want to die/i;

/** Words in the answer that break this player's rules (ignoring "no X", "avoid X", "gluten-free X"). */
export function unsafeMentions(p: AthleteProfile, text: string): string[] {
  const c = safetyContext(p);
  const cleaned = text.toLowerCase()
    .replace(/\b(no|avoid|avoiding|without|skip|never|not|free of|allergic to|allergy to|instead of)\s+[a-z ,-]{0,30}/g, " ")
    .replace(/\b[a-z]+-free\s+[a-z]+/g, " ")
    .replace(/\b[a-z]+-free\b/g, " ");
  const hits = new Set<string>();
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noPlantMilk = cleaned.replace(/\b(soy|oat|rice|coconut|pea|almond|cashew) milk\b/g, " ");
  for (const f of FOODS) {
    if (!unsafeReason(f, c) || f.roles.includes("ingredient")) continue;
    const nm = f.name.replace(/^(a|an) /, "");
    const hay = /^(soy|oat|rice|coconut|pea|almond|cashew) /.test(nm) ? cleaned : noPlantMilk;
    if (new RegExp(`\\b${esc(nm)}\\b`, "i").test(hay)) hits.add(f.name);
  }
  for (const a of c.allergens) {
    // Plant milks aren't dairy (they're checked under their own allergen).
    const t = a === "milk" ? cleaned.replace(/\b(soy|oat|rice|coconut|pea|almond|cashew) milk\b/g, " ") : cleaned;
    const m = ALLERGEN_WORDS[a] && t.match(ALLERGEN_WORDS[a]);
    if (m) hits.add(m[0]);
  }
  for (const w of c.blockWords) if (new RegExp(`\\b${esc(w)}`, "i").test(cleaned)) hits.add(w);
  return [...hits];
}

export class AskService {
  constructor(
    private readonly profiles: AthleteProfileRepository,
    private readonly checkins: CheckInRepository,
    private readonly family: FamilyService,
    private readonly records: RecordRepository,
    private readonly weather: WeatherProvider | null,
    private readonly http: typeof fetch = fetch,
  ) {}

  async ask(userId: string, profileId: string, question: string, history: ChatTurn[], today: string, now: string): Promise<AskResult> {
    const owner = await this.family.ownerFor(userId, profileId);
    if (!owner) return { ok: false, code: "not_found" };
    const p = await this.profiles.getById(owner, profileId);
    if (!p) return { ok: false, code: "not_found" };
    const q = String(question || "").trim();
    if (!q || q.length > 600) return { ok: false, code: "invalid", message: "Ask a question under 600 characters." };
    if (CRISIS.test(q)) return { ok: true, value: { answer: "I'm really glad you said something. Please call or text 988 right now (Suicide & Crisis Lifeline, any time, free). If you're in danger, call 911. Tell a parent, coach or another adult you trust today. You don't have to handle this alone.", checked: true } };
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, code: "not_configured", message: "Ask the app isn't set up on the server yet." };
    const day = new Date().toISOString().slice(0, 10);
    const uid = `ask:${userId}:${day}`;
    const used = await this.records.get<{ n: number }>("usage", uid);
    if ((used?.data.n ?? 0) >= 30) return { ok: false, code: "limit", message: "That's 30 questions today. Try again tomorrow." };
    await this.records.put({ id: uid, kind: "usage", key: day, ownerId: userId, data: { n: (used?.data.n ?? 0) + 1 } });

    const system = await this.systemPrompt(p, owner, today, now);
    const msgs = [
      ...(Array.isArray(history) ? history : []).slice(-6).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").map((t) => ({ role: t.role, content: t.content.slice(0, 1500) })),
      { role: "user" as const, content: q },
    ];
    try {
      let answer = await this.call(key, system, msgs);
      let bad = unsafeMentions(p, answer);
      if (bad.length) {
        answer = await this.call(key, system, [...msgs, { role: "assistant", content: answer }, { role: "user", content: `That answer mentions ${bad.join(", ")}, which break this player's food rules. Rewrite it without them. Don't mention them at all.` }]);
        bad = unsafeMentions(p, answer);
      }
      if (bad.length) return { ok: true, value: { answer: "I couldn't give a safe answer to that one. Check the Meals and Game Day screens: every food there already fits your food rules. For anything specific, ask a parent or a registered dietitian.", checked: false } };
      return { ok: true, value: { answer, checked: true } };
    } catch (err) {
      console.warn("ask failed", (err as Error).message);
      return { ok: false, code: "failed", message: "Couldn't answer right now. Try again in a minute." };
    }
  }

  private async call(key: string, system: string, messages: { role: string; content: string }[]): Promise<string> {
    const res = await this.http("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 600, system, messages }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  }

  async systemPrompt(p: AthleteProfile, owner: string, today: string, now: string): Promise<string> {
    const age = effectiveAge(p.identity);
    const prog = buildProgram(p);
    const safe = safetySummary(p);
    const c = safetyContext(p);
    const r = routineOf(p);
    const upcoming = sortedEvents(p).filter((e) => eventDate(e) >= today).slice(0, 5).map((e) => `${shortDate(eventDate(e))} ${e.startTime.length > 10 ? to12(eventTime(e, r.practice)) : "all day"} ${e.type}${e.title ? ` (${e.title})` : ""}`);
    const wx = await loadWeather(this.weather, p, today, 2).catch(() => undefined);
    const wp = dayWeatherPlan(p, today, wx);
    const ci = await this.checkins.getByDate(owner, p.id, today);
    const pos = positionFuel(p);
    const unsafeFoods = FOODS.filter((f) => unsafeReason(f, c)).map((f) => f.name);
    const kid = age !== undefined && age < 13;
    return [
      "You are the nutrition and recovery assistant inside a youth and adult soccer app. Be warm, short and practical: 2 to 6 short sentences or a short list. Plain words. No em dashes.",
      kid ? "The player is under 13, so you are talking to their parent. Refer to the player by first name." : "You are talking to the player.",
      `Player: ${p.identity.fullName.split(" ")[0]}, age ${age ?? "unknown"}, ${p.identity.sex}, position ${pos.position || "unknown"}. Age program: ${prog.band.name} (${prog.band.ages}).`,
      `Program numbers: protein about ${prog.numbers.proteinPerMealText} per meal; fluids about ${prog.numbers.fluidsBaseL} L a day before training; sleep ${prog.numbers.sleepHours[0]}-${prog.numbers.sleepHours[1]} h; warm-up ${prog.numbers.warmupMin} min.`,
      `Age rules: in-game fuel "${prog.rules.inGame}". Caffeine: ${prog.rules.caffeine}. Supplements: ${prog.rules.supplements}.`,
      `FOOD RULES (never break these, never suggest these foods or dishes that contain them): allergies ${safe.allergies.map((a: any) => `${a.allergen === "other" ? a.note : a.allergen}${a.avoidCrossContact || a.severity === "severe" ? " (strict, no may-contain)" : ""}`).join(", ") || "none"}; diets ${safe.diets.join(", ") || "none"}; intolerances ${safe.intolerances.join(", ") || "none"}; medical diets ${safe.medicalDiets.join(", ") || "none"}; won't eat: ${c.blockWords.join(", ") || "nothing listed"}.`,
      unsafeFoods.length ? `Specifically never mention: ${unsafeFoods.join(", ")}.` : "",
      "If you are not sure a food is safe for these rules, don't suggest it. Remind them to read labels when it matters.",
      `Today is ${today}, local time ${now.slice(11, 16)}. Upcoming: ${upcoming.join("; ") || "nothing scheduled"}.`,
      wp && wp.severity !== "none" ? `Weather today: ${wp.conditions.headline}. ${wp.warnings[0] || ""}` : "",
      ci ? `Today's check-in: sleep ${ci.sleepHoursLastNight ?? "?"} h, energy ${ci.energyLevel ?? "?"}/10, soreness ${ci.sorenessLevel ?? "?"}/10${ci.fever ? ", has a fever" : ""}.` : "",
      "Never give weight-loss advice or comment on body size to anyone under 18. Talk about fuel, energy and performance instead.",
      "For injuries, pain, illness, concussion, medication, eating concerns or mental health: give only general safe steps and tell them to talk to a parent, doctor, athletic trainer or counselor. For a crisis, give 988 (call or text).",
      "You are not a doctor. Don't diagnose.",
    ].filter(Boolean).join("\n");
  }
}
