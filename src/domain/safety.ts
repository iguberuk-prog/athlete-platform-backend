/**
 * Emergency card and SafeSport resources (pure).
 */

import type { AthleteProfile } from "./profile.js";
import { effectiveAge } from "./profile.js";

export interface EmergencyCard {
  name: string;
  age: number | null;
  lines: { label: string; value: string; urgent?: boolean }[];
  contacts: { label: string; name?: string; phone: string }[];
  steps: string[];
}

const ALLERGEN: Record<string, string> = { peanut: "Peanuts", tree_nut: "Tree nuts", milk: "Milk", egg: "Eggs", wheat: "Wheat", gluten: "Gluten", soy: "Soy", fish: "Fish", shellfish: "Shellfish", sesame: "Sesame" };

export function emergencyCard(p: AthleteProfile): EmergencyCard {
  const allergies = p.nutrition.allergies || [];
  const severe = allergies.filter((a) => a.severity === "severe" || a.anaphylaxis || a.epinephrine);
  const lines: EmergencyCard["lines"] = [];
  if (allergies.length) lines.push({ label: "Allergies", value: allergies.map((a) => (a.allergen === "other" ? a.note || "Other" : ALLERGEN[a.allergen] || a.allergen) + (a.severity === "severe" || a.anaphylaxis ? " (severe)" : "")).join(", "), urgent: severe.length > 0 });
  if (allergies.some((a) => a.epinephrine)) lines.push({ label: "EpiPen", value: "Carries an epinephrine auto-injector. Check the bag.", urgent: true });
  if ((p.nutrition.medicalDiets || []).includes("type1_diabetes")) lines.push({ label: "Diabetes", value: "Type 1 diabetes. If confused, shaky or sweaty: give fast sugar and call a parent.", urgent: true });
  if ((p.nutrition.medicalDiets || []).includes("celiac")) lines.push({ label: "Celiac", value: "No gluten at all." });
  if (p.health?.asthma?.has) lines.push({ label: "Asthma", value: "Rescue inhaler in the bag." + (p.health.asthma.preExerciseInhaler ? " Uses it before exercise." : ""), urgent: true });
  const meds = p.health?.medications || [];
  if (meds.length) lines.push({ label: "Medications", value: meds.join(", ") });
  const conds = p.health?.medicalConditions || [];
  if (conds.length) lines.push({ label: "Conditions", value: conds.join(", ") });
  if ((p.health?.concussions || []).some((c) => !c.clearedAt)) lines.push({ label: "Concussion", value: "Recovering. Not cleared to play.", urgent: true });
  const ct = p.contact || {};
  const contacts: EmergencyCard["contacts"] = [];
  if (ct.emergencyContact?.phone) contacts.push({ label: ct.emergencyContact.relationship || "Emergency contact", name: ct.emergencyContact.name, phone: ct.emergencyContact.phone });
  if (ct.parentPhone && ct.parentPhone !== ct.emergencyContact?.phone) contacts.push({ label: "Parent", phone: ct.parentPhone });
  const steps: string[] = [];
  if (allergies.some((a) => a.epinephrine)) steps.push("Allergic reaction with trouble breathing, swelling or vomiting: use the EpiPen in the outer thigh, then call 911.");
  if (p.health?.asthma?.has) steps.push("Asthma attack: sit up, use the rescue inhaler. No better in a few minutes, or lips turn blue: call 911.");
  steps.push("Head injury: remove from play. Call 911 for any danger sign: vomiting, drowsiness, confusion, one pupil bigger.");
  steps.push("Call the contacts above.");
  return { name: p.identity.fullName, age: effectiveAge(p.identity) ?? null, lines, contacts, steps };
}

export const SAFESPORT = {
  intro: "Everyone in soccer has the right to be safe. No adult should make you feel uncomfortable, ask you to keep secrets, message you privately in a way that feels wrong, or be alone with you out of sight of others.",
  signs: [
    "An adult gives one player special gifts, rides or attention.",
    "An adult asks a player to keep a secret or to talk privately online.",
    "Touching that feels uncomfortable, even if it's called a joke or a massage.",
    "Yelling, name-calling or punishments that go way past normal coaching.",
    "Pressure to play through injury or skip meals to make weight.",
  ],
  whatToDo: [
    "Tell a parent or another adult you trust. You won't be in trouble.",
    "If someone is in danger right now, call 911.",
    "Report it. You can report anonymously.",
  ],
  links: [
    { label: "U.S. Center for SafeSport: report a concern", url: "https://uscenterforsafesport.org/report-a-concern/" },
    { label: "U.S. Soccer: report a concern", url: "https://www.ussoccer.com/safeguarding/report-a-concern" },
    { label: "Childhelp National Child Abuse Hotline: call or text 1-800-422-4453", url: "https://childhelphotline.org/" },
  ],
  parents: [
    "Ask your club about its SafeSport training and background-check rules for coaches.",
    "Adults should communicate with minors in group messages that include parents.",
    "Know your club's safeguarding officer and how to reach them.",
  ],
};
