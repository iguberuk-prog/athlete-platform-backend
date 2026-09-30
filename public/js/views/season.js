// Season review: a one-page summary to save as PDF or print.

import { esc, todayStr, niceDate, msg } from "../ui.js";
import { api, errText } from "../api.js";

export async function render(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/season?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const s = r.data, st = s.stats;
  const keeper = s.position === "goalkeeper";
  el.innerHTML = `
    <div class="actions noprint" style="margin-top:0"><button class="btn primary block" data-act="sPrint">Save as PDF</button></div>
    <p class="disc noprint">On iPhone: tap Save as PDF, then Share, then Save to Files.</p>
    <article class="review printable">
      <div class="eh">SEASON REVIEW ${esc(s.season.from.slice(0, 4))}-${esc(s.season.to.slice(2, 4))}</div>
      <h1>${esc(s.name)}</h1>
      <div class="rowsub">${esc(s.position.replace(/_/g, " "))}${s.team ? ` · ${esc(s.team)}` : ""}</div>
      <div class="stats">
        <div class="stat"><div class="k">Games</div><div class="v">${st.games}</div><div class="u">${st.starts} starts</div></div>
        <div class="stat"><div class="k">Minutes</div><div class="v">${st.minutes}</div></div>
        <div class="stat"><div class="k">${keeper ? "Saves" : "Goals"}</div><div class="v">${keeper ? st.saves : st.goals}</div><div class="u">${keeper ? `${st.cleanSheets} clean sheets` : `${st.assists} assists`}</div></div>
        <div class="stat"><div class="k">Record</div><div class="v small">${st.wins}-${st.draws}-${st.losses}</div></div>
      </div>
      <h3>Habits</h3>
      <p>${s.checkins} daily check-ins. Longest streak ${s.bestStreak} days. ${s.warmups} injury-prevention warm-ups.${s.avgSleep ? ` Averaged ${s.avgSleep} hours of sleep.` : ""}</p>
      ${s.badges.length ? `<p><b>Badges:</b> ${esc(s.badges.join(", "))}</p>` : ""}
      ${s.highlights.length ? `<h3>Highlights</h3><ul class="list">${s.highlights.map((h) => `<li><span class="bullet"></span><div><span class="dim">${esc(niceDate(h.date))}</span> ${esc(h.text)}</div></li>`).join("")}</ul>` : ""}
      ${s.goals.length ? `<h3>Working on</h3><ul class="list">${s.goals.map((g) => `<li><span class="bullet"></span><div>${esc(g)}</div></li>`).join("")}</ul>` : ""}
      ${s.worked.length ? `<h3>What worked</h3><ul class="list">${s.worked.map((w) => `<li><span class="bullet"></span><div>${esc(w.text)}</div></li>`).join("")}</ul>` : ""}
      ${st.minutesByMonth.length ? `<h3>Minutes by month</h3><div class="mbars">${st.minutesByMonth.map((m) => `<div><i style="height:${Math.max(4, Math.round((m.minutes / Math.max(...st.minutesByMonth.map((x) => x.minutes))) * 80))}px"></i><span>${esc(new Date(m.month + "-15").toLocaleDateString("en-US", { month: "short" }))}</span></div>`).join("")}</div>` : ""}
      <p class="disc">Made with Athlete Performance.</p>
    </article>`;
}
export const actions = { sPrint: () => window.print() };
