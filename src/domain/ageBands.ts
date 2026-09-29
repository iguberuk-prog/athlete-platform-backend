/**
 * Age programs.
 *
 * Every athlete falls into one of seven programs based on age (from date of
 * birth, so it moves up automatically on birthdays). The program changes what
 * the app actually recommends, not just labels:
 *
 *   targets      plates for young kids, a gram guide for 10-14, grams from 15
 *   protein      g/kg per day and per meal (older athletes need more per meal)
 *   sleep        hours by age (9-12 for 6-12, 8-10 for 13-18, 7-9 for adults)
 *   hydration    baseline fluids, and what to drink during play
 *   in-game fuel water and fruit for kids; sports drinks and gels from 15
 *   caffeine     none under 15, avoid 15-18, optional and timed for adults
 *   supplements  none for kids, food first for teens, evidence-based for adults
 *   recovery     extra easy days for 33+, longer warm-ups, strength work
 *   voice        under 13, reminders and advice speak to the parent
 *
 * Guidance draws on published youth and adult sports-nutrition and sleep
 * recommendations (e.g. AASM sleep durations, AAP guidance on caffeine and
 * energy drinks for children and teens, ISSN protein position stand). It is
 * general education, not individual medical advice.
 */

export type BandId = "foundations" | "growth" | "development" | "performance" | "prime" | "veteran" | "masters";
export type TargetsMode = "plates" | "guide" | "grams";

export interface AgeBand {
  id: BandId;
  name: string;
  ages: string;
  min: number;
  max: number;
  tagline: string;
  targetsMode: TargetsMode;
  proteinPerKg: [number, number];
  /** Protein per meal, g/kg (spread over 4 feedings). */
  perMealProteinPerKg: number;
  /** Baseline daily fluid, ml per kg, before training. */
  fluidMlPerKg: number;
  /** "water_fruit": water plus fruit at half-time. "sports": sports drink and gels allowed. */
  inGame: "water_fruit" | "sports";
  allowGels: boolean;
  caffeine: "none" | "avoid" | "optional";
  /** Extra easy days after a game (added to the recovery plan). */
  extraRecoveryDays: number;
  warmupMin: number;
  focus: string[];
  fuel: string[];
  hydration: string[];
  sleep: string[];
  recovery: string[];
  supplements: string[];
  avoid: string[];
  watch: string[];
}

export const AGE_BANDS: AgeBand[] = [
  {
    id: "foundations", name: "Foundations", ages: "6-9", min: 6, max: 9,
    tagline: "Build the habits: regular meals, water, sleep and fun.",
    targetsMode: "plates", proteinPerKg: [1.0, 1.2], perMealProteinPerKg: 0.25, fluidMlPerKg: 50,
    inGame: "water_fruit", allowGels: false, caffeine: "none", extraRecoveryDays: 0, warmupMin: 10,
    focus: [
      "Three meals and two snacks every day, so energy is steady for play.",
      "Water is the drink. Keep a bottle in the sports bag.",
      "Lots of sleep: this is when kids grow and recover.",
      "Try new foods without pressure. Variety beats perfection.",
    ],
    fuel: [
      "Use the plate: half carbs ({carbs}), a quarter protein, a quarter fruit and vegetables.",
      "A small snack 1-2 hours before practice, like {snack}.",
      "No counting grams or calories at this age. Serve normal portions and let them eat to hunger.",
    ],
    hydration: [
      "Drink water with every meal and during every break.",
      "A sports drink only when it's hot or play goes over an hour.",
    ],
    sleep: ["9-12 hours a night. Same bedtime on school nights and game nights.", "Screens off an hour before bed."],
    recovery: [
      "A good meal and an early night after games is all the recovery kids need.",
      "Free play counts as recovery. Rest if something hurts.",
    ],
    supplements: ["No supplements, protein powders or energy products. Food covers everything at this age."],
    avoid: ["Energy drinks and caffeine", "Gels and caffeinated products", "Diet talk or skipping meals"],
    watch: [
      "Headache, dizziness or confusion in the heat: stop, cool down, drink, and get help.",
      "Pain that makes them limp or that lasts more than a few days: see the pediatrician.",
      "Big changes in appetite or energy: mention it to the pediatrician.",
    ],
  },
  {
    id: "growth", name: "Growth", ages: "10-14", min: 10, max: 14,
    tagline: "Growth spurts raise the fuel bill. Never skip meals.",
    targetsMode: "guide", proteinPerKg: [1.2, 1.6], perMealProteinPerKg: 0.3, fluidMlPerKg: 45,
    inGame: "water_fruit", allowGels: false, caffeine: "none", extraRecoveryDays: 0, warmupMin: 10,
    focus: [
      "Growing and training at the same time takes a lot of fuel. Breakfast every day.",
      "Calcium and iron matter now: calcium from {calcium}; iron from {iron}.",
      "A snack before every practice, and a real meal after.",
      "Protect sleep. It drives growth and recovery.",
    ],
    fuel: [
      "Plate first: half carbs, a quarter protein, a quarter fruit and vegetables. Bigger plates on game days.",
      "Gram numbers are a rough guide only. Appetite during growth spurts is real hunger.",
      "3 servings a day of calcium-rich foods for growing bones, like {calcium}.",
    ],
    hydration: [
      "Water before, during and after practice.",
      "A sports drink only in heat or for sessions over an hour.",
    ],
    sleep: ["9-11 hours a night.", "Keep phones out of the bedroom at night."],
    recovery: [
      "Recovery snack within an hour after games: carbs plus protein.",
      "After tournaments, one easy day. Growth plates are sensitive to overuse.",
    ],
    supplements: ["No supplements, protein powders, creatine or pre-workouts. Real food does the job."],
    avoid: ["Energy drinks and caffeine", "Pre-workouts and supplements", "Cutting food groups to lose weight"],
    watch: [
      "Heel or knee pain that keeps coming back (common in growth spurts): see a doctor or trainer.",
      "Always tired, losing weight, or getting hurt often: talk to the pediatrician.",
    ],
  },
  {
    id: "development", name: "Development", ages: "15-18", min: 15, max: 18,
    tagline: "Train like an athlete: fuel to the session, recover on purpose.",
    targetsMode: "grams", proteinPerKg: [1.4, 1.8], perMealProteinPerKg: 0.3, fluidMlPerKg: 35,
    inGame: "sports", allowGels: true, caffeine: "avoid", extraRecoveryDays: 0, warmupMin: 15,
    focus: [
      "Match carbs to the day: more on game and hard training days, less on rest days.",
      "Protein at four meals and snacks, not all at dinner.",
      "Sleep 8-10 hours. It's the best recovery tool and it's free.",
      "Practice your game-day food in training, never try something new on game day.",
    ],
    fuel: [
      "Full gram targets from here, scaled to your body weight.",
      "Pre-game meal 3-4 hours before, top-up snack 1 hour before.",
      "Sports drink or a caffeine-free gel at half-time in long or hot games.",
    ],
    hydration: [
      "Start every session hydrated: pale-yellow urine.",
      "In heat, add electrolytes. Weigh before and after hard sessions to learn your sweat loss.",
    ],
    sleep: ["8-10 hours a night.", "A 20-30 minute nap is fine. Not after 4 PM."],
    recovery: [
      "Recovery snack within 30 minutes of hard sessions.",
      "One easy day after games. Two after a tournament.",
    ],
    supplements: [
      "Food first. Pediatric and sports-medicine groups advise against creatine and pre-workouts under 18.",
      "A multivitamin or iron only if a doctor finds a need.",
    ],
    avoid: ["Energy drinks (high caffeine and sugar)", "Pre-workouts and creatine under 18", "Crash diets or cutting weight"],
    watch: [
      "Always tired, frequent injuries or stress fractures, or big weight changes: these can mean not eating enough for training. See a doctor.",
      "For female athletes: missed or irregular periods are a signal to see a doctor, not a normal part of training.",
    ],
  },
  {
    id: "performance", name: "Performance", ages: "19-24", min: 19, max: 24,
    tagline: "Peak training years. Periodize fuel and own your recovery.",
    targetsMode: "grams", proteinPerKg: [1.6, 2.0], perMealProteinPerKg: 0.3, fluidMlPerKg: 35,
    inGame: "sports", allowGels: true, caffeine: "optional", extraRecoveryDays: 0, warmupMin: 15,
    focus: [
      "Carbs follow the training load. Protein stays high every day.",
      "Build a repeatable game-day routine and stick to it.",
      "Sleep is non-negotiable in a busy schedule.",
    ],
    fuel: [
      "Full gram targets scaled to body weight and day type.",
      "30-60 g carbs per hour in games; up to 90 g/h in very long or extra-time games if your gut is trained for it.",
    ],
    hydration: ["Know your sweat rate. Replace about 150% of what you lose after sessions, with salt."],
    sleep: ["7-9 hours, aim for 8+.", "Consistent wake time, even on weekends."],
    recovery: [
      "24-48 hours between hard sessions.",
      "Alcohol slows muscle repair and rehydration. Skip it after games.",
    ],
    supplements: [
      "Best evidence: caffeine (about 3 mg/kg, 60 minutes before) and creatine monohydrate (3-5 g a day).",
      "Only use third-party tested products (for example NSF Certified for Sport).",
    ],
    avoid: ["Caffeine within 8 hours of bed", "Untested supplements", "Alcohol after games"],
    watch: ["Persistent fatigue or repeated soft-tissue injuries: review sleep and fueling with a professional."],
  },
  {
    id: "prime", name: "Prime", ages: "25-32", min: 25, max: 32,
    tagline: "Consistency wins: plan meals around work, protect sleep and recovery.",
    targetsMode: "grams", proteinPerKg: [1.6, 2.0], perMealProteinPerKg: 0.3, fluidMlPerKg: 35,
    inGame: "sports", allowGels: true, caffeine: "optional", extraRecoveryDays: 0, warmupMin: 15,
    focus: [
      "Work and life stress add up. Plan meals ahead so game days aren't improvised.",
      "Two strength sessions a week keep injuries away.",
      "Guard your sleep window like a training session.",
    ],
    fuel: ["Full gram targets by day type.", "Batch-cook carbs and proteins twice a week."],
    hydration: ["Start games hydrated. Electrolytes in heat and after heavy sweating."],
    sleep: ["7-9 hours.", "Wind-down routine: screens off, cool dark room."],
    recovery: ["48 hours between hard sessions after a game.", "Mobility 10 minutes a day."],
    supplements: ["Caffeine and creatine have the best evidence. Third-party tested only."],
    avoid: ["Caffeine late in the day", "Alcohol after games", "Skipping the warm-up"],
    watch: ["Recurring hamstring or calf strains: add strength work and a longer warm-up."],
  },
  {
    id: "veteran", name: "Veteran", ages: "33-45", min: 33, max: 45,
    tagline: "Recovery takes longer now. Train smarter, warm up longer, eat more protein per meal.",
    targetsMode: "grams", proteinPerKg: [1.6, 2.0], perMealProteinPerKg: 0.35, fluidMlPerKg: 35,
    inGame: "sports", allowGels: true, caffeine: "optional", extraRecoveryDays: 1, warmupMin: 20,
    focus: [
      "Muscles need more protein per meal to rebuild: about 0.35-0.4 g/kg, four times a day.",
      "An extra easy day after games. 48-72 hours between hard efforts.",
      "Warm up 20 minutes. Tendons and calves need it.",
      "Two strength sessions a week protect joints and speed.",
    ],
    fuel: ["Full gram targets. Carbs by day type, protein high and evenly spread.", "Protein before bed on game nights."],
    hydration: ["Drink on a schedule during games, not only when thirsty."],
    sleep: ["7-9 hours. Sleep quality drops with stress: keep a steady routine.", "No caffeine within 8 hours of bed."],
    recovery: [
      "Day after a game: walk, mobility, easy bike. No sprinting.",
      "Two easy days after tournaments.",
      "Foam rolling and calf and hip mobility daily.",
    ],
    supplements: ["Creatine has good evidence for strength and muscle at this age. Third-party tested only.", "Check vitamin D with your doctor if you train mostly indoors or in winter."],
    avoid: ["Going hard two days in a row", "Skipping warm-ups", "Heavy alcohol after games"],
    watch: ["Chest pain, unusual breathlessness or dizziness: stop and see a doctor.", "Achilles or calf tightness that doesn't ease: back off and get it checked."],
  },
  {
    id: "masters", name: "Masters", ages: "46+", min: 46, max: 120,
    tagline: "Keep playing for years: protein, bones, hydration and patient recovery.",
    targetsMode: "grams", proteinPerKg: [1.6, 2.0], perMealProteinPerKg: 0.4, fluidMlPerKg: 35,
    inGame: "sports", allowGels: true, caffeine: "optional", extraRecoveryDays: 1, warmupMin: 20,
    focus: [
      "About 0.4 g/kg protein at each meal (roughly 30-40 g) keeps muscle as you age.",
      "Calcium and vitamin D foods for bones, like {calcium}.",
      "Thirst fades with age. Drink on a schedule.",
      "72 hours between hard efforts. Extra easy days are part of training.",
    ],
    fuel: ["Full gram targets by day type.", "A quality protein at every meal, like {protein}."],
    hydration: ["Scheduled drinking: a few sips every 15-20 minutes in games.", "Some medications change how you handle heat. Ask your doctor."],
    sleep: ["7-8 hours. A short early-afternoon nap is fine.", "Keep a steady wake time."],
    recovery: [
      "Day after a game: walk, swim or easy bike. Two easy days after tournaments.",
      "Balance, strength and mobility work twice a week.",
    ],
    supplements: ["Creatine and vitamin D have useful evidence. Talk to your doctor first, especially if you take medications."],
    avoid: ["Back-to-back hard days", "Short warm-ups", "Training through chest pain or dizziness"],
    watch: ["Chest pain, pressure, unusual breathlessness, palpitations or dizziness: stop immediately and get medical care.", "Get a doctor's OK before a big jump in training."],
  },
];

export function bandForAge(age: number | undefined): AgeBand {
  if (age === undefined || !Number.isFinite(age)) return AGE_BANDS[3];
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max) || (age < 6 ? AGE_BANDS[0] : AGE_BANDS[6]);
}

/** Recommended sleep hours by exact age (AASM ranges). */
export function sleepHoursFor(age: number | undefined): [number, number] {
  if (age === undefined) return [8, 9];
  if (age <= 12) return [9, 12];
  if (age <= 18) return [8, 10];
  return [7, 9];
}

/** Under 13, advice and reminders are written for the parent. */
export const parentVoice = (age: number | undefined) => age !== undefined && age < 13;
