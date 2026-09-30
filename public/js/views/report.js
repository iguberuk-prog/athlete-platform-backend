// Weekly report: last 7 days and the week ahead.

import { esc, todayStr, msg } from "../ui.js";
import { api, errText } from "../api.js";

const list = (items) => `<ul class="list">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;
const TYPE = { match: "Game", training: "Practice", recovery: "Recovery", travel: "Travel", tournament: "Tournament" };

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/report?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const d = r.data, L = d.lastWeek;
  el.innerHTML = `
    <section class="hero"><div class="greet">Last 7 days</div><div class="headline">${esc(d.firstName)}'s week</div></section>
    <div class="stats">
      <div class="stat"><div class="k">Check-ins</div><div class="v">${L.checkins}<span class="u">/7</span></div></div>
      <div class="stat"><div class="k">Sleep</div><div class="v">${L.avgSleep ?? "–"}<span class="u"> h</span></div><div class="u">target ${L.sleepTarget[0]}-${L.sleepTarget[1]}</div></div>
      <div class="stat"><div class="k">Sessions</div><div class="v">${L.sessions}</div><div class="u">${L.hours} hours</div></div>
      <div class="stat"><div class="k">Energy</div><div class="v">${L.avgEnergy ?? "–"}<span class="u">/10</span></div></div>
    </div>
    ${d.highlights.length ? `<div class="card" style="margin-top:14px">${list(d.highlights)}</div>` : ""}
    ${L.soreSpots.length ? `<div class="card"><h3>Sore spots</h3>${list(L.soreSpots)}</div>` : ""}
    ${d.alerts.length ? `<div class="card"><h3>Worth a look</h3>${d.alerts.map((a) => `<div class="${a.level === "stop" ? "msg err" : "warnbox"}"><b>${esc(a.title)}.</b> ${esc(a.detail)}</div>`).join("")}</div>` : ""}
    <div class="card"><h3>Coming up</h3>${d.nextWeek.length ? `<ul class="list">${d.nextWeek.map((n) => `<li><div style="flex:1"><div class="rowtitle">${esc(n.label)} · ${esc(n.time)}</div><div class="rowsub">${esc(n.title || TYPE[n.type] || n.type)}</div></div></li>`).join("")}</ul>` : `<p class="sub">Nothing on the schedule.</p>`}</div>
    ${p.features?.weeklyParentReport ? `<p class="disc">Linked parents get this by email on Sunday evenings. Turn it off in Account.</p>` : ""}`;
}

export const actions = {};
