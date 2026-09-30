// Check-in: 30 seconds, big tap targets. Optional Apple Health fill on iPhone.

import { $, $$, esc, todayStr, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { isNative, requestHealth } from "../native.js";
import { active } from "../app.js";
import { readinessRing, statusPill } from "./today.js";

const SCALES = [
  ["energyLevel", "Energy", "Drained", "Full tank"],
  ["sorenessLevel", "Soreness", "Fresh", "Very sore"],
  ["stressLevel", "Stress", "Calm", "Stressed"],
  ["hydrationLevel", "Hydration", "Thirsty", "Well hydrated"],
];
const MINUTES = [0, 30, 45, 60, 75, 90, 120];
let form = {};
let feat = {};

// Body map regions, grouped so it reads like a body from top to bottom.
const REGIONS = [
  ["Head and back", [["head", "Head"], ["neck", "Neck"], ["back", "Upper back"], ["lower_back", "Lower back"]]],
  ["Hips and thighs", [["hip_l", "Hip L"], ["hip_r", "Hip R"], ["groin", "Groin"], ["quad_l", "Thigh L"], ["quad_r", "Thigh R"], ["hamstring_l", "Hamstring L"], ["hamstring_r", "Hamstring R"]]],
  ["Knees and lower legs", [["knee_l", "Knee L"], ["knee_r", "Knee R"], ["shin_l", "Shin L"], ["shin_r", "Shin R"], ["calf_l", "Calf L"], ["calf_r", "Calf R"]]],
  ["Ankles and feet", [["ankle_l", "Ankle L"], ["ankle_r", "Ankle R"], ["heel_l", "Heel L"], ["heel_r", "Heel R"], ["foot_l", "Foot L"], ["foot_r", "Foot R"]]],
  ["Upper body", [["shoulder_l", "Shoulder L"], ["shoulder_r", "Shoulder R"]]],
];
const LEVELS = [0, 3, 6, 8];
const LEVEL_TXT = { 3: "a bit", 6: "sore", 8: "hurts" };
const URINE = ["#fdfbe3", "#fbf6c2", "#f7ee9b", "#f1e173", "#e8cd4c", "#dcb52f", "#c7962a", "#a8752a"];
const CYCLE = [["cramps", "Cramps"], ["tired", "Tired"], ["headache", "Headache"], ["bloating", "Bloating"], ["low_mood", "Low mood"], ["heavy_flow", "Heavy flow"]];

const toggle = (k, label, sub = "") => `<label class="check"><input type="checkbox" data-act="ciFlag" data-k="${k}" ${form[k] ? "checked" : ""}><span>${label}${sub ? `<div class="rowsub">${sub}</div>` : ""}</span></label>`;

function bodyMap() {
  const lv = (r) => (form.soreSpots || []).find((s) => s.region === r)?.level || 0;
  return `<label class="f">Anything hurt? <span class="dim">(tap again for more)</span></label>
    ${REGIONS.map(([g, rs]) => `<div class="rowsub" style="margin:8px 0 4px">${g}</div><div class="chips">${rs.map(([r, t]) => {
      const l = lv(r);
      return `<button type="button" class="chip sore l${l}" data-act="ciSore" data-r="${r}">${t}${l ? ` · ${LEVEL_TXT[l]}` : ""}</button>`;
    }).join("")}</div>`).join("")}`;
}

function scale(key, label, lo, hi) {
  return `<label class="f">${label}</label>
    <div class="scale" role="radiogroup" aria-label="${label}">${Array.from({ length: 10 }, (_, i) =>
      `<button type="button" role="radio" aria-checked="${form[key] === i + 1}" class="${form[key] === i + 1 ? "on" : ""}" data-act="ciScale" data-k="${key}" data-v="${i + 1}">${i + 1}</button>`).join("")}</div>
    <div class="scaleEnds"><span>${lo}</span><span>${hi}</span></div>`;
}

function draw(el) {
  el.innerHTML = `
    <form class="card" data-submit="saveCheckin" novalidate>
      <div class="eyebrow">${esc(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}</div>
      <h2>How are you today?</h2>
      <p class="sub">Tap and go. It tunes today's plan and your recovery.</p>
      ${isNative() ? `<button type="button" class="btn ghost sm" data-act="ciHealth">Fill sleep from Apple Health</button>` : ""}
      <label class="f">Sleep last night</label>
      <div class="stepper">
        <button type="button" data-act="ciSleep" data-d="-0.5" aria-label="Less sleep">−</button>
        <div class="num" aria-live="polite">${form.sleepHoursLastNight}<small>hours</small></div>
        <button type="button" data-act="ciSleep" data-d="0.5" aria-label="More sleep">+</button>
      </div>
      ${SCALES.map((s) => scale(...s)).join("")}
      <label class="f">Trained or played today?</label>
      <div class="chips">${MINUTES.map((m) => `<label class="chip"><input type="radio" name="mins" value="${m}" ${form.sessionMinutes === m ? "checked" : ""} data-act="ciMins">${m === 0 ? "Not yet / rest" : m + " min"}</label>`).join("")}</div>
      <div id="rpeBox" ${form.sessionMinutes ? "" : "hidden"}>${scale("sessionRpe", "How hard was it?", "Easy", "All-out")}</div>
      <div class="sectionTitle" style="margin-top:18px">Body check</div>
      ${bodyMap()}
      ${feat.urineColor ? `<label class="f">Pee color <span class="dim">(1 pale, 8 dark)</span></label>
        <div class="urine" role="radiogroup" aria-label="Urine color">${URINE.map((c, i) => `<button type="button" role="radio" aria-checked="${form.urineColor === i + 1}" class="${form.urineColor === i + 1 ? "on" : ""}" style="background:${c}" data-act="ciUrine" data-v="${i + 1}">${i + 1}</button>`).join("")}</div>` : ""}
      <div class="checks">
        ${toggle("warmupDone", "Did my injury-prevention warm-up")}
        ${toggle("sick", "Feeling sick", "Cold, stomach bug, body aches")}
        ${toggle("fever", "Fever", "100.4°F / 38°C or higher")}
        ${toggle("headSymptoms", "Headache, dizzy or foggy after a hit", "We'll show what to do next")}
        ${active()?.health?.asthma?.has ? toggle("inhalerUsed", "Needed my rescue inhaler") : ""}
        ${toggle("breathingDone", "Did a breathing exercise")}
        ${feat.cycle && active()?.advanced?.menstrualCycleTracking ? toggle("period", "Period today") : ""}
      </div>
      ${feat.cycle && active()?.advanced?.menstrualCycleTracking && form.period ? `<div class="chips">${CYCLE.map(([k, t]) => `<button type="button" class="chip ${(form.cycleSymptoms || []).includes(k) ? "on" : ""}" data-act="ciCycle" data-k="${k}">${t}</button>`).join("")}</div>` : ""}
      ${feat.burnoutCheck ? scale("enjoyment", "Enjoying soccer lately?", "Not at all", "Love it") : ""}
      <label class="f" for="notes">Notes <span class="dim">(optional)</span></label>
      <textarea class="input" id="notes" placeholder="Anything worth remembering: a knock, bad sleep, big exam…">${esc(form.notes || "")}</textarea>
      <div class="actions"><button class="btn primary block" type="submit">Save check-in</button></div>
      <div id="out"></div>
    </form>`;
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/checkins?limit=1`);
  if (!ctx.seq()) return;
  const last = r.ok ? r.data.checkins?.[0] : null;
  const todays = last && last.date === todayStr() ? last : null;
  form = {
    sleepHoursLastNight: todays?.sleepHoursLastNight ?? last?.sleepHoursLastNight ?? 8,
    energyLevel: todays?.energyLevel, sorenessLevel: todays?.sorenessLevel,
    stressLevel: todays?.stressLevel, hydrationLevel: todays?.hydrationLevel,
    sessionMinutes: todays?.sessionMinutes ?? 0, sessionRpe: todays?.sessionRpe,
    restingHeartRate: todays?.restingHeartRate, hrvMs: todays?.hrvMs,
    notes: todays?.notes || "",
    soreSpots: todays?.soreSpots || [], urineColor: todays?.urineColor, sick: todays?.sick, fever: todays?.fever,
    headSymptoms: todays?.headSymptoms, inhalerUsed: todays?.inhalerUsed, warmupDone: todays?.warmupDone,
    breathingDone: todays?.breathingDone, period: todays?.period, cycleSymptoms: todays?.cycleSymptoms || [],
    enjoyment: todays?.enjoyment,
  };
  feat = p.features || {};
  draw(el);
  if (todays) $("#out").innerHTML = msg("info", "You already checked in today. Saving again updates it.");
}

export const actions = {
  ciScale(btn) {
    form[btn.dataset.k] = Number(btn.dataset.v);
    $$(`button[data-k="${btn.dataset.k}"]`).forEach((b) => {
      const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on));
    });
  },
  ciSore(btn) {
    const r = btn.dataset.r;
    const spots = form.soreSpots || [];
    const cur = spots.find((x) => x.region === r)?.level || 0;
    const next = LEVELS[(LEVELS.indexOf(cur) + 1) % LEVELS.length];
    form.soreSpots = next ? [...spots.filter((x) => x.region !== r), { region: r, level: next }] : spots.filter((x) => x.region !== r);
    btn.className = `chip sore l${next}`;
    btn.textContent = btn.textContent.split(" · ")[0] + (next ? ` · ${LEVEL_TXT[next]}` : "");
  },
  ciUrine(btn) {
    form.urineColor = Number(btn.dataset.v);
    $$(".urine button").forEach((b) => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  },
  ciFlag(input) {
    setTimeout(() => {
      form[input.dataset.k] = input.checked;
      if (input.dataset.k === "period") { form.notes = $("#notes").value; draw(document.getElementById("view")); }
    });
  },
  ciCycle(btn) {
    const k = btn.dataset.k, cur = form.cycleSymptoms || [];
    form.cycleSymptoms = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    btn.classList.toggle("on");
  },
  ciSleep(btn) {
    form.sleepHoursLastNight = Math.max(0, Math.min(14, form.sleepHoursLastNight + Number(btn.dataset.d)));
    btn.parentElement.querySelector(".num").innerHTML = `${form.sleepHoursLastNight}<small>hours</small>`;
  },
  ciMins(input) {
    // Chip radios: let the browser check the box, then read it.
    setTimeout(() => {
      form.sessionMinutes = Number(input.value);
      $("#rpeBox").hidden = !form.sessionMinutes;
    });
  },
  async ciHealth() {
    const h = await requestHealth();
    if (!h) return toast("Couldn't read Apple Health. Check permissions in the Health app.");
    if (typeof h.sleepHours === "number") form.sleepHoursLastNight = Math.round(h.sleepHours * 2) / 2;
    if (typeof h.restingHeartRate === "number") form.restingHeartRate = Math.round(h.restingHeartRate);
    if (typeof h.hrvMs === "number") form.hrvMs = Math.round(h.hrvMs);
    form.notes = $("#notes").value;
    draw(document.getElementById("view"));
    toast("Filled from Apple Health");
  },
  async saveCheckin(f) {
    const p = active();
    const body = { date: todayStr(), ...form, notes: $("#notes").value.trim() || undefined };
    if (!body.sessionMinutes) { delete body.sessionMinutes; delete body.sessionRpe; }
    for (const k of ["sick", "fever", "headSymptoms", "inhalerUsed", "warmupDone", "breathingDone", "period"]) if (!body[k]) delete body[k];
    if (!body.soreSpots?.length) delete body.soreSpots;
    if (!body.period || !body.cycleSymptoms?.length) delete body.cycleSymptoms;
    for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === null) delete body[k];
    const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
    const r = await api(`/api/profiles/${p.id}/checkins`, { method: "POST", body });
    btn.disabled = false;
    if (!r.ok) { $("#out").innerHTML = msg("err", errText(r)); return; }
    const t = await api(`/api/profiles/${p.id}/today?date=${todayStr()}`);
    const rd = t.ok ? t.data.readiness : null;
    document.getElementById("view").innerHTML = `
      <div class="card" style="text-align:center">
        <div class="eyebrow">Checked in</div>
        ${rd ? `<div style="display:flex;justify-content:center;margin:14px 0">${readinessRing(rd.score, rd.status)}</div><div>${statusPill(rd)}</div>
          <ul class="list" style="text-align:left;margin-top:16px">${rd.advice.map((a) => `<li><span class="bullet"></span><div>${esc(a)}</div></li>`).join("")}</ul>` : "<p>Saved.</p>"}
        ${body.fever || body.headSymptoms || (body.urineColor || 0) >= 6 || (body.soreSpots || []).some((x) => x.level >= 6)
          ? `<div class="warnbox" style="text-align:left">${body.fever ? "Fever: no training today. " : ""}${body.headSymptoms ? "Head symptoms: no more play today. See the Health screen for next steps. " : ""}${(body.urineColor || 0) >= 6 ? "Dark pee: drink 2 to 3 cups of water now. " : ""}${(body.soreSpots || []).some((x) => x.level >= 6) ? "Something hurts: ease off and watch it." : ""}</div>
            <div class="actions"><button class="btn ghost block" data-act="nav" data-to="#/health">Open Health</button></div>` : ""}
        <div class="actions"><button class="btn primary block" data-act="nav" data-to="#/today">See today's plan</button></div>
      </div>`;
  },
};

