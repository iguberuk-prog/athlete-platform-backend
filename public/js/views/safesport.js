// Safe sport: signs, what to do, where to report.

import { esc, todayStr, msg } from "../ui.js";
import { api, errText } from "../api.js";

const list = (xs) => `<ul class="list">${xs.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

export async function render(el, ctx) {
  const r = ctx.profile ? await api(`/api/profiles/${ctx.profile.id}/extras?date=${todayStr()}`) : null;
  if (!ctx.seq()) return;
  if (r && !r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const s = r?.data.safesport;
  if (!s) { el.innerHTML = `<div class="card"><a class="btn primary block" href="https://uscenterforsafesport.org/report-a-concern/" target="_blank" rel="noopener">Report a concern</a></div>`; return; }
  el.innerHTML = `
    <div class="card"><p>${esc(s.intro)}</p></div>
    <div class="card"><h3>Warning signs</h3>${list(s.signs)}</div>
    <div class="card"><h3>What to do</h3>${list(s.whatToDo)}
      ${s.links.map((l) => `<a class="btn ghost block" style="margin-top:8px" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>
    <div class="card"><h3>For parents</h3>${list(s.parents)}</div>
    <p class="disc">In an emergency, call 911.</p>`;
}
export const actions = {};
