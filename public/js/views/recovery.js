// Recovery: multi-day plan after a game, with tournament turnaround windows.

import { esc, todayStr, to12, relDay, niceDate } from "../ui.js";
import { api, errText } from "../api.js";
import { statusPill } from "./today.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  const q = ctx.query.match ? `&match=${ctx.query.match}` : "";
  const r = await api(`/api/profiles/${p.id}/recovery?date=${todayStr()}${q}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  const rp = r.data;

  if (!rp.anchor) {
    const past = (p.schedule?.events || []).filter((e) => e.type === "match" && e.startTime.slice(0, 10) < todayStr()).slice(-3).reverse();
    el.innerHTML = `
      <div class="card empty"><div class="big">No recent game</div><p>${esc(rp.message)}</p>
      <button class="btn ghost" data-act="nav" data-to="#/schedule">Open schedule</button></div>
      ${past.length ? `<div class="sectionTitle">Earlier games</div>${past.map((e) => `<button class="tile" data-act="nav" data-to="#/recovery?match=${e.startTime.slice(0, 10)}"><span><div class="tt">${esc(niceDate(e.startTime.slice(0, 10)))}</div><div class="ts">Kickoff ${esc(to12(e.startTime.slice(11, 16)))}</div></span><span class="chev">›</span></button>`).join("")}` : ""}
      ${generalTips()}`;
    return;
  }

  const today = todayStr();
  const header = rp.tournament
    ? `<section class="hero"><div class="greet">Tournament recovery</div><div class="headline">${rp.matches.length} games in ${Math.round((new Date(rp.matches.at(-1).date) - new Date(rp.matches[0].date)) / 86400000) + 1} days</div>
       <div class="note">${rp.matches.map((m) => `${esc(relDay(m.date))} ${esc(to12(m.time))}`).join(" · ")}</div></section>`
    : `<section class="hero"><div class="greet">Recovery plan</div><div class="headline">After ${esc(relDay(rp.anchor.date).toLowerCase() === "today" ? "today's game" : niceDate(rp.anchor.date))}</div>
       <div class="note">Kickoff was ${esc(to12(rp.anchor.time))}. Here is how to bounce back.</div></section>`;

  const windows = rp.windows.filter((w) => w.kind !== "normal").map((w) => `
    <div class="window ${w.kind}">
      <div class="rowtitle">${esc(w.title)}</div>
      <div class="rowsub">After the game ending ${esc(to12(w.from.slice(11)))} ${esc(relDay(w.from.slice(0, 10)).toLowerCase())}</div>
      <ol>${w.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>`).join("");

  const days = rp.days.map((d) => `
    <div class="dayc ${d.date === today ? "today" : ""}" ${d.date === today ? 'id="todayCard"' : ""}>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div class="eyebrow">${esc(d.label)}${d.date === today ? " · Today" : ""}</div>
        ${d.readiness ? statusPill(d.readiness) : ""}
      </div>
      <div class="rowtitle" style="font-size:16px;margin-top:4px">${esc(d.title)}</div>
      <div class="macro"><span>Carbs <b>${esc(d.carbs)}</b></span><span>Protein <b>${esc(d.protein)}</b></span></div>
      <ul>${d.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      ${d.foods.length ? `<div class="foods">Try: ${d.foods.map(esc).join(", ")}</div>` : ""}
    </div>`).join("");

  el.innerHTML = `${header}
    ${windows ? `<div class="card"><h3>Between games</h3>${windows}</div>` : ""}
    <div class="sectionTitle">Day by day</div>
    ${days}
    ${generalTips()}
    <p class="disc">${esc(rp.disclaimer)}</p>`;
  document.getElementById("todayCard")?.scrollIntoView({ block: "center" });
}

function generalTips() {
  return `<div class="card"><h3>Recovery basics</h3><ul class="list">
    <li><span class="bullet"></span><div><b>Sleep first.</b> 8-10 hours for teens. Nothing else you do matters as much.</div></li>
    <li><span class="bullet"></span><div><b>Refuel fast.</b> Carbs and protein within 30-60 minutes after hard sessions.</div></li>
    <li><span class="bullet"></span><div><b>Rehydrate.</b> About 1.5 times what you sweated out, with some salt.</div></li>
    <li><span class="bullet"></span><div><b>Move easy.</b> A walk or light spin beats lying still the day after.</div></li>
    <li><span class="bullet"></span><div><b>Speak up.</b> Pain that is sharp, one-sided, or getting worse goes to a trainer or doctor.</div></li>
  </ul></div>`;
}

export const actions = {};
