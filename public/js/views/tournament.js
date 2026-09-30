// Tournament weekends: fuel between games, cooler list, hotel tips.

import { esc, todayStr, niceDate, msg } from "../ui.js";
import { api, errText } from "../api.js";

const list = (xs) => `<ul class="list">${xs.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

export async function render(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/extras?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const ts = r.data.tournaments;
  if (!ts.length) {
    el.innerHTML = `<div class="card empty"><div class="big">No tournament in the next 3 weeks</div><p>Any 2+ games within 48 hours shows up here with a full plan. Add games in Schedule, or subscribe to your team calendar.</p>
      <button class="btn primary" data-act="nav" data-to="#/schedule">Open schedule</button></div>`;
    return;
  }
  el.innerHTML = ts.map((t) => `
    <section class="hero"><div class="greet">${esc(niceDate(t.start))}${t.end !== t.start ? ` to ${esc(niceDate(t.end))}` : ""}</div><div class="headline">${t.games.length} games</div></section>
    <div class="card"><h3>Games</h3><ul class="list">${t.games.map((g) => `<li><div style="flex:1"><div class="rowtitle">${esc(g.label)} · ${esc(g.time)}</div><div class="rowsub">${esc(g.title || "Game")}${g.zip ? ` · ZIP ${esc(g.zip)}` : ""} · done about ${esc(g.endsAt)}</div></div></li>`).join("")}</ul></div>
    <div class="card"><h3>Fuel between games</h3>${t.gaps.map((g) => `<div class="rowtitle" style="margin-top:8px">${esc(g.after)} to ${esc(g.before)}</div>${list(g.plan)}`).join("")}</div>
    <div class="card"><h3>Night before</h3>${list(t.nightBefore)}</div>
    <div class="card"><h3>Pack the cooler</h3>${list(t.cooler)}</div>
    <div class="card"><h3>Hotel</h3>${list(t.hotel)}</div>
    ${t.foodNearField.length ? `<div class="card"><h3>Food near the fields</h3>${t.foodNearField.map((f) => `<a class="btn ghost block" href="${esc(f.url)}" target="_blank" rel="noopener">Restaurants near ${esc(f.zip)}</a>`).join("")}
      <p class="disc">See Meals, then Eating out, for what to order.</p></div>` : ""}`).join("");
}
export const actions = {};
