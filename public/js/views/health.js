// Health: alerts first, then only the sections this player's age gets.

import { $, esc, todayStr, niceDate, msg, toast, lbToKg } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender, isParent } from "../app.js";

const list = (items) => `<ul class="list">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;
const LV = { stop: "err", warn: "warnbox", info: "info" };
let data = null;

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/health?date=${todayStr()}${isParent() ? "&viewer=parent" : ""}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  data = r.data;
  const f = data.features.on;
  const c = data.concussion;
  const us = !data.parentVoice;

  el.innerHTML = `
    ${data.alerts.length ? data.alerts.map((a) => `<div class="${a.level === "warn" ? "warnbox" : `msg ${LV[a.level]}`}" style="margin:0 0 10px"><b>${esc(a.title)}.</b> ${esc(a.detail)}</div>`).join("")
      : `<div class="msg ok" style="margin:0 0 12px">No health flags today. Nice.</div>`}

    <div class="card" id="concussion">
      <h3>Head injury and concussion</h3>
      ${c.active ? `
        <div class="rowsub">Return to play</div>
        <ol class="rtp">${data.returnSteps.map((s) => `<li class="${s.step < c.step ? "done" : s.step === c.step ? "now" : ""}"><b>${s.step}. ${esc(s.title)}</b><div class="rowsub">${esc(s.detail)}</div></li>`).join("")}</ol>
        <p>${esc(c.message)}</p>
        <div class="actions">
          ${c.canAdvance ? `<button class="btn primary" data-act="hStep" data-sym="0">Done with this step, no symptoms</button>` : ""}
          <button class="btn ghost" data-act="hStep" data-sym="1">Symptoms came back</button>
        </div>
        ${c.needsProviderClearance ? `<form data-submit="hClear" class="sub2"><label class="f" for="clrBy">Provider's written clearance</label>
          <input class="input" id="clrBy" placeholder="Doctor or athletic trainer name" required>
          <input class="input" id="clrDate" type="date" value="${todayStr()}" style="margin-top:8px">
          <button class="btn primary block" style="margin-top:8px">Record clearance</button></form>` : ""}`
      : `<p class="sub">After any hit to the head or a hard fall: stop playing for the day. Never "shake it off".</p>
        <form data-submit="hReport" class="row2"><input class="input" type="date" id="cDate" value="${todayStr()}"><button class="btn ghost">Report a head injury</button></form>`}
      <details class="table"><summary>Call 911 right away if you see</summary>${list(data.dangerSigns)}</details>
    </div>

    ${data.asthma.length ? `<div class="card"><h3>Asthma plan</h3>${list(data.asthma)}</div>` : ""}

    ${data.school ? `<div class="card"><h3>School day</h3>${data.school.schoolDay ? `<ul class="list">${data.school.steps.map((s) => `<li><div style="flex:1"><div class="rowtitle">${esc(s.time)} · ${esc(s.label)}</div><div class="rowsub">${esc(s.detail)}</div></div></li>`).join("")}</ul>${list(data.school.tips)}` : `<p class="sub">${esc(data.school.tips[0])}</p>`}</div>`
      : f.schoolDay ? `<div class="card"><h3>School day</h3><p class="sub">Add school hours so snacks and meals fit around class.</p><button class="btn ghost sm" data-act="nav" data-to="#/profile/edit?school=1">Add school hours</button></div>` : ""}

    ${data.travel.map((t) => `<div class="card"><h3>Away: ${esc(niceDate(t.event.date))}${t.event.place ? ` in ${esc(t.event.place)}` : ""}</h3>
      <div class="rowsub">Sleep</div>${list(t.sleep)}<div class="rowsub">Food</div>${list(t.food)}<div class="rowsub">Pack</div>${list(t.packing)}</div>`).join("")}

    <div class="card"><h3>${esc(data.warmup.name)} · ${data.warmup.minutes} min</h3><p class="sub">${esc(data.warmup.why)}</p>
      ${data.warmup.parts.map((pt) => `<div class="rowtitle" style="margin-top:10px">${esc(pt.name)} · ${pt.minutes} min</div>${list(pt.moves)}`).join("")}
      ${data.warmup.extra.length ? list(data.warmup.extra) : ""}</div>

    ${f.sweatTest ? `<div class="card" id="sweat"><h3>Sweat test</h3>
      ${data.sweat.rateLph ? `<p><b>${data.sweat.rateLph} L per hour</b> (from ${data.sweat.tests.length} test${data.sweat.tests.length === 1 ? "" : "s"})</p>${list(data.sweat.advice)}` : `<p class="sub">Find out how much you sweat, so you know how much to drink. Weigh yourself right before and right after a practice, in shorts, towel-dried.</p>`}
      <form data-submit="hSweat" class="grid2">
        <label>Weight before (lb)<input class="input" id="swPre" type="number" step="0.1" required></label>
        <label>Weight after (lb)<input class="input" id="swPost" type="number" step="0.1" required></label>
        <label>Drank during (oz)<input class="input" id="swFluid" type="number" step="1" value="0"></label>
        <label>Minutes<input class="input" id="swMin" type="number" value="90"></label>
        <button class="btn primary block" style="grid-column:1/-1">Save sweat test</button>
      </form></div>` : ""}

    ${f.growth ? `<div class="card"><h3>Growth</h3>${data.growth ? list(data.growth.advice) : ""}
      <form data-submit="hHeight" class="row2"><input class="input" id="htIn" type="number" step="0.25" placeholder="Height in inches" required><button class="btn ghost">Log height</button></form></div>` : ""}

    ${data.cycle ? `<div class="card"><h3>Cycle</h3>
      ${data.cycle.lastStart ? `<p class="sub">Last period started ${esc(niceDate(data.cycle.lastStart))}. Next expected around ${esc(niceDate(data.cycle.predictedNext))}.</p>` : `<p class="sub">Log period days in your daily check-in.</p>`}
      ${data.cycle.advice.length ? list(data.cycle.advice) : ""}<p class="disc">Private. Never shown to coaches.</p></div>` : ""}

    <div class="card"><h3>${us ? "Calm and focus" : "Calm down games"}</h3>
      ${data.wellbeing.tips.length ? list(data.wellbeing.tips) : ""}
      ${data.wellbeing.breathing.map((b) => `<details class="table"><summary>${esc(b.name)} · ${b.minutes >= 1 ? b.minutes + " min" : "30 sec"}</summary><p class="sub">${esc(b.when)}</p><ol class="hsteps">${b.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>`).join("")}
      ${data.wellbeing.support.talk ? `<p class="sub">${esc(data.wellbeing.support.talk)}</p>` : ""}
      ${data.wellbeing.support.crisis ? `<div class="msg info">${esc(data.wellbeing.support.crisis)}</div>` : ""}
    </div>

    <div class="card"><h3>This week's load</h3>
      <p>${data.load.sessions} session${data.load.sessions === 1 ? "" : "s"}, ${data.load.weekHours} hours${data.load.maxHours ? ` (guideline: up to ${data.load.maxHours})` : ""}. ${data.load.restDays} day${data.load.restDays === 1 ? "" : "s"} off.</p>
      ${data.load.doubleBooked.map((d) => `<div class="warnbox">${esc(niceDate(d.date))}: ${esc(d.detail)}</div>`).join("")}
      ${data.acclimatization ? `<div class="rowsub" style="margin-top:8px">Preseason heat plan, day ${data.acclimatization.day} of 14</div>${list(data.acclimatization.rules)}` : ""}
    </div>

    ${Object.keys(data.features.off).length ? `<details class="table"><summary>Not included at this age</summary>${list([...new Set(Object.values(data.features.off))])}</details>` : ""}
    <p class="disc">General guidance, not medical advice. For injuries, illness or anything that worries you, see a doctor.</p>`;
}

const reload = () => rerender();

export const actions = {
  async hReport() {
    const r = await api(`/api/profiles/${active().id}/health/concussion`, { method: "POST", body: { date: $("#cDate").value } });
    if (!r.ok) return toast(errText(r));
    toast("Recorded. Start with rest."); reload();
  },
  async hStep(btn) {
    const r = await api(`/api/profiles/${active().id}/health/concussion/step`, { method: "POST", body: { date: todayStr(), symptoms: btn.dataset.sym === "1" } });
    if (!r.ok) return toast(errText(r));
    reload();
  },
  async hClear() {
    const r = await api(`/api/profiles/${active().id}/health/concussion/clear`, { method: "POST", body: { date: $("#clrDate").value, clearedBy: $("#clrBy").value } });
    if (!r.ok) return toast(errText(r));
    toast("Cleared for full play."); reload();
  },
  async hSweat() {
    const lbToKgF = (v) => lbToKg(Number(v));
    const body = { date: todayStr(), preKg: lbToKgF($("#swPre").value), postKg: lbToKgF($("#swPost").value), fluidL: Math.round(Number($("#swFluid").value || 0) * 0.0295735 * 100) / 100, minutes: Number($("#swMin").value) };
    const r = await api(`/api/profiles/${active().id}/health/sweat-test`, { method: "POST", body });
    if (!r.ok) return toast(errText(r));
    toast(`Sweat rate: ${r.data.test.rateLph} L per hour`); reload();
  },
  async hHeight() {
    const cm = Math.round(Number($("#htIn").value) * 2.54 * 10) / 10;
    const r = await api(`/api/profiles/${active().id}/health/height`, { method: "POST", body: { date: todayStr(), heightCm: cm } });
    if (!r.ok) return toast(errText(r));
    toast("Height saved"); reload();
  },
};
