// Progress: streaks, badges and this week's early warning score.

import { esc, icon, todayStr, msg } from "../ui.js";
import { api, errText } from "../api.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  const [r, k] = await Promise.all([api(`/api/profiles/${p.id}/progress?date=${todayStr()}`), api(`/api/profiles/${p.id}/risk?date=${todayStr()}`)]);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const g = r.data, risk = k.ok ? k.data : null;
  const col = { low: "var(--good)", moderate: "var(--warn)", high: "var(--bad)" };
  el.innerHTML = `
    <section class="hero"><div class="greet">${g.points.toLocaleString()} points</div><div class="headline">${g.earnedCount} badge${g.earnedCount === 1 ? "" : "s"}</div></section>
    <div class="stats">${g.streaks.map((s) => `<div class="stat"><div class="k">${esc(s.label)}</div><div class="v">${s.current}<span class="u"> ${esc(s.unit)}</span></div><div class="u">best ${s.best}${s.doneToday ? " · done today" : ""}</div></div>`).join("")}</div>
    ${g.freeze ? `<div class="card freeze"><h3>${icon("shield")} Streak freeze</h3><p class="sub" style="margin:0">${g.freeze.available ? "1 freeze ready this month. Miss one day and your streak keeps going." : "This month's freeze is used. You get a new one next month."}${g.freeze.usedOn.length ? ` Saved your streak on ${esc(g.freeze.usedOn.slice(-3).join(", "))}.` : ""}</p></div>` : ""}
    ${risk ? `<div class="card" style="margin-top:14px;border-color:${col[risk.level]}"><h3>Injury risk this week: <span style="color:${col[risk.level]}">${risk.level}</span></h3>
      ${risk.notCleared ? `<div class="msg err">Not cleared to play (concussion steps).</div>` : ""}
      ${risk.factors.length ? `<ul class="list">${risk.factors.map((f) => `<li><span class="bullet"></span><div>${esc(f.text)}</div></li>`).join("")}</ul>` : ""}
      <div class="rowsub" style="margin-top:6px">What to do</div><ul class="list">${risk.actions.map((a) => `<li><span class="bullet"></span><div>${esc(a)}</div></li>`).join("")}</ul>
      <p class="disc">A heads-up from sleep, soreness, training load, stress and growth. Not a diagnosis. ${risk.dataDays < 10 ? "More check-ins make it sharper." : ""}</p></div>` : ""}
    <div class="card"><h3>Badges</h3><div class="badges">${g.badges.map((b) => `<div class="badge ${b.earned ? "on" : ""}">
      <div class="bi">${icon(b.icon)}</div><div class="bn">${esc(b.name)}</div><div class="bd">${esc(b.detail)}</div>
      ${b.earned ? "" : `<div class="bar"><i style="width:${Math.round((b.progress / b.goal) * 100)}%"></i></div><div class="bd">${b.progress}/${b.goal}</div>`}</div>`).join("")}</div></div>`;
}

export const actions = {};
