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
  };
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
        <div class="actions"><button class="btn primary block" data-act="nav" data-to="#/today">See today's plan</button></div>
      </div>`;
  },
};

