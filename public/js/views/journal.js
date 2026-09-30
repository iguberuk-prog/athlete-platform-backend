// Journal: 30-second post-game reflection, stats log, and what worked.

import { $, $$, esc, todayStr, niceDate, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender } from "../app.js";

const MEALS = [["carb_meal", "Carb-rich meal"], ["light_snack", "Light snack"], ["fast_food", "Fast food"], ["skipped", "Skipped"], ["other", "Other"]];
const FACES = ["Rough", "Meh", "OK", "Good", "Great"];
const MINS = [0, 15, 30, 45, 60, 70, 80, 90];
let f = {};

function stepper(k, label) {
  return `<div class="mini"><div class="rowsub">${label}</div><div class="stepper sm"><button type="button" data-act="jStep" data-k="${k}" data-d="-1">−</button><div class="num" id="n_${k}">${f[k] || 0}</div><button type="button" data-act="jStep" data-k="${k}" data-d="1">+</button></div></div>`;
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/journal?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const { logs, stats, worked } = r.data;
  const keeper = (p.sport.positions || [])[0] === "goalkeeper";
  f = { date: todayStr(), type: "match", minutes: undefined, goals: 0, assists: 0, saves: 0 };
  el.innerHTML = `
    <form class="card" data-submit="jSave" novalidate>
      <h2>After the game</h2>
      <p class="sub">30 seconds. Over a season this becomes your journal, and it shows what works for you.</p>
      <div class="row2"><input class="input" type="date" id="jDate" value="${todayStr()}">
        <div class="seg" id="jType"><button type="button" class="on" data-act="jType" data-v="match">Game</button><button type="button" data-act="jType" data-v="training">Practice</button></div></div>
      <label class="f">How did it go?</label>
      <div class="chips">${FACES.map((t, i) => `<button type="button" class="chip" data-act="jRate" data-v="${i + 1}">${t}</button>`).join("")}</div>
      <label class="f">Minutes played</label>
      <div class="chips">${MINS.map((m) => `<button type="button" class="chip" data-act="jMin" data-v="${m}">${m}</button>`).join("")}</div>
      <div id="gameOnly">
        <div class="chips" style="margin-top:8px"><button type="button" class="chip" data-act="jRes" data-v="win">Win</button><button type="button" class="chip" data-act="jRes" data-v="draw">Draw</button><button type="button" class="chip" data-act="jRes" data-v="loss">Loss</button>
          <label class="chip"><input type="checkbox" id="jStart"> Started</label></div>
        <div class="minis">${stepper("goals", "Goals")}${stepper("assists", "Assists")}${keeper ? stepper("saves", "Saves") : ""}</div>
        <input class="input" id="jOpp" placeholder="Opponent (optional)" style="margin-top:8px">
      </div>
      <label class="f">What did you eat before?</label>
      <div class="chips">${MEALS.map(([k, t]) => `<button type="button" class="chip" data-act="jMeal" data-v="${k}">${t}</button>`).join("")}</div>
      <label class="f" for="jWell">One thing that went well</label><input class="input" id="jWell" maxlength="200">
      <label class="f" for="jWork">One thing to work on</label><input class="input" id="jWork" maxlength="200">
      <div class="actions"><button class="btn primary block">Save</button></div>
    </form>

    <div class="card"><h3>This season</h3>
      <div class="stats">
        <div class="stat"><div class="k">Games</div><div class="v">${stats.games}</div><div class="u">${stats.starts} starts</div></div>
        <div class="stat"><div class="k">Minutes</div><div class="v">${stats.minutes}</div></div>
        <div class="stat"><div class="k">${keeper ? "Saves" : "Goals"}</div><div class="v">${keeper ? stats.saves : stats.goals}</div><div class="u">${keeper ? `${stats.cleanSheets} clean sheets` : `${stats.assists} assists`}</div></div>
        <div class="stat"><div class="k">Record</div><div class="v small">${stats.wins}-${stats.draws}-${stats.losses}</div></div>
      </div></div>

    <div class="card"><h3>What works for you</h3>
      ${worked.insights.length ? `<ul class="list">${worked.insights.map((i) => `<li><span class="bullet"></span><div>${esc(i.text)}${i.strength === "hint" ? ` <span class="dim">(early pattern)</span>` : ""}</div></li>`).join("")}</ul>`
        : `<p class="sub">Log ${worked.needMore || "a few more"} more game${worked.needMore === 1 ? "" : "s"} with your daily check-ins, and patterns show up here.</p>`}
    </div>

    <div class="card"><h3>Journal</h3>
      ${logs.length ? logs.slice(0, 30).map((l) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${esc(niceDate(l.date))} · ${l.type === "match" ? "Game" : "Practice"}${l.opponent ? ` vs ${esc(l.opponent)}` : ""}${l.rating ? ` · ${FACES[l.rating - 1]}` : ""}</div>
        <div class="rowsub">${[l.minutes != null ? `${l.minutes} min` : "", l.goals ? `${l.goals} goal${l.goals > 1 ? "s" : ""}` : "", l.assists ? `${l.assists} assist${l.assists > 1 ? "s" : ""}` : "", l.saves ? `${l.saves} saves` : "", l.result || ""].filter(Boolean).join(" · ")}</div>
        ${l.wentWell ? `<div class="small">+ ${esc(l.wentWell)}</div>` : ""}${l.workOn ? `<div class="small dim">→ ${esc(l.workOn)}</div>` : ""}</div>
        <button class="btn ghost sm" data-act="jDel" data-id="${l.id}" aria-label="Delete">✕</button></div>`).join("") : `<p class="sub">Nothing yet.</p>`}
    </div>`;
}

const pickOne = (btn) => btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));

export const actions = {
  jType(btn) { f.type = btn.dataset.v; pickOne(btn); $("#gameOnly").hidden = f.type !== "match"; },
  jRate(btn) { f.rating = Number(btn.dataset.v); pickOne(btn); },
  jMin(btn) { f.minutes = Number(btn.dataset.v); pickOne(btn); },
  jRes(btn) { f.result = btn.dataset.v; $$('[data-act="jRes"]').forEach((b) => b.classList.toggle("on", b === btn)); },
  jMeal(btn) { f.preGameMeal = btn.dataset.v; pickOne(btn); },
  jStep(btn) { const k = btn.dataset.k; f[k] = Math.max(0, Math.min(30, (f[k] || 0) + Number(btn.dataset.d))); $(`#n_${k}`).textContent = f[k]; },
  async jSave() {
    const body = { ...f, date: $("#jDate").value, started: $("#jStart")?.checked || undefined, opponent: $("#jOpp")?.value || undefined, wentWell: $("#jWell").value || undefined, workOn: $("#jWork").value || undefined };
    if (body.type !== "match") { delete body.goals; delete body.assists; delete body.saves; delete body.result; delete body.started; delete body.opponent; }
    for (const k of ["goals", "assists", "saves"]) if (!body[k]) delete body[k];
    const r = await api(`/api/profiles/${active().id}/journal`, { method: "POST", body });
    if (!r.ok) return toast(errText(r));
    toast("Saved to your journal"); rerender();
  },
  async jDel(btn) {
    if (!confirm("Delete this entry?")) return;
    const r = await api(`/api/profiles/${active().id}/journal/${btn.dataset.id}`, { method: "DELETE" });
    toast(r.ok ? "Deleted" : errText(r)); rerender();
  },
};
