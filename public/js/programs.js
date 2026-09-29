// Age programs (display copy; the server holds the full rules in src/domain/ageBands.ts).

export const PROGRAMS = [
  { id: "foundations", name: "Foundations", ages: "6-9", min: 6, max: 9, tagline: "Build the habits: regular meals, water, sleep and fun." },
  { id: "growth", name: "Growth", ages: "10-14", min: 10, max: 14, tagline: "Growth spurts raise the fuel bill. Never skip meals." },
  { id: "development", name: "Development", ages: "15-18", min: 15, max: 18, tagline: "Train like an athlete: fuel to the session, recover on purpose." },
  { id: "performance", name: "Performance", ages: "19-24", min: 19, max: 24, tagline: "Peak training years. Periodize fuel and own your recovery." },
  { id: "prime", name: "Prime", ages: "25-32", min: 25, max: 32, tagline: "Consistency wins: plan meals around work, protect sleep and recovery." },
  { id: "veteran", name: "Veteran", ages: "33-45", min: 33, max: 45, tagline: "Recovery takes longer now. Train smarter, warm up longer, eat more protein per meal." },
  { id: "masters", name: "Masters", ages: "46+", min: 46, max: 120, tagline: "Keep playing for years: protein, bones, hydration and patient recovery." },
];

export function ageFromDob(dob, now = new Date()) {
  if (!dob) return undefined;
  const d = new Date(dob + "T12:00:00");
  if (Number.isNaN(d.getTime())) return undefined;
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

export function programFor(age) {
  if (age === undefined) return null;
  return PROGRAMS.find((p) => age >= p.min && age <= p.max) || (age < 6 ? PROGRAMS[0] : PROGRAMS[6]);
}
