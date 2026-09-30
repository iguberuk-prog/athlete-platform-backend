/**
 * Mental skills library (original content), with a simpler version for kids
 * under 11. Short, practical, soccer-specific.
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";

export interface MentalSkill { id: string; title: string; when: string; steps: string[] }

const TEEN: MentalSkill[] = [
  { id: "routine", title: "Pre-game routine", when: "The 60 minutes before kickoff.", steps: [
    "Same order every game: gear, snack, warm-up, two minutes of quiet. Routines calm nerves because your brain knows what's next.",
    "Pick one job for the game, like 'first touch away from pressure' or 'talk to my back line'. Just one.",
    "Picture three moments going well: a good first touch, a hard tackle won, a smart pass.",
    "Box breathing for 1 minute before you walk out.",
  ] },
  { id: "focus", title: "Focus cues", when: "During the game, when your mind drifts.", steps: [
    "Use a one-word cue: 'scan', 'next', 'win it'. Say it in your head when the ball goes out.",
    "Before you receive, check your shoulder twice. It keeps you in the present and makes you faster.",
    "At set pieces, pick your person and your spot. Nothing else matters for those 10 seconds.",
  ] },
  { id: "mistakes", title: "After a mistake", when: "Right after a bad pass, a miss, or a goal against.", steps: [
    "Physical reset: wipe your hands on your shorts or tap your chest. That's the end of it.",
    "One breath: in through the nose, long breath out.",
    "Say your cue: 'next play'. The best players have short memories.",
    "Do something simple and positive in the next 10 seconds: a short pass, a sprint back, a loud call.",
  ] },
  { id: "bench", title: "Being on the bench", when: "When you're not starting or you get subbed off.", steps: [
    "Stay in the game: watch your position and pick one thing you'd do differently. You'll go in ready.",
    "Keep warm and loose. Coaches notice who's ready.",
    "After the game, ask the coach one question: 'What's one thing I can do to earn more minutes?' Then work on it.",
    "Minutes go up and down all season. Your effort in training is the part you control.",
  ] },
  { id: "nerves", title: "Big-game nerves", when: "The night before and the morning of a big game.", steps: [
    "Nerves mean you care. Your body is getting ready. Call it 'excited'.",
    "Stick to your normal food and bedtime. Big games are the worst time to try something new.",
    "Write down three things you do well. Read them on the way to the field.",
  ] },
  { id: "loss", title: "After a tough loss", when: "The evening after.", steps: [
    "Give yourself an hour to be upset. That's normal.",
    "Then write one thing that went well and one thing to work on. Leave the rest.",
    "Eat, drink and sleep like a recovery day. Your body doesn't know you lost.",
    "Talk to someone you trust if it's still weighing on you a few days later.",
  ] },
  { id: "confidence", title: "Building confidence", when: "Any week.", steps: [
    "Confidence comes from reps. Pick one skill and do 10 extra minutes of it three times this week.",
    "Keep a 'wins' list in your journal: small things count.",
    "Compare yourself to last month's you, not to teammates.",
  ] },
];

const KIDS: MentalSkill[] = [
  { id: "routine", title: "Game-day superpowers", when: "Before the game.", steps: ["Pack your bag with a grown-up.", "Do your warm-up with the team.", "Take 3 big balloon breaths.", "Pick your job: 'run hard' or 'be a good teammate'."] },
  { id: "mistakes", title: "Oops! What now?", when: "When something goes wrong.", steps: ["Clap your hands once. The oops is gone.", "Take one big breath.", "Say 'next ball!' and run to help your team."] },
  { id: "bench", title: "Sitting out for a bit", when: "When it's someone else's turn.", steps: ["Cheer for your team. Loud!", "Watch where the ball goes so you're ready.", "Everyone gets turns. Your turn is coming."] },
  { id: "loss", title: "When we lose", when: "After the game.", steps: ["It's OK to feel sad.", "Say one thing you did well today.", "Have your snack, drink water, and have fun with friends."] },
];

export function mentalSkills(profile: AthleteProfile): { skills: MentalSkill[]; kid: boolean } {
  const age = effectiveAge(profile.identity) ?? 15;
  return age < 11 ? { skills: KIDS, kid: true } : { skills: TEEN, kid: false };
}
