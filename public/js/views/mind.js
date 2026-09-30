// Mind: mental skills library, plus breathing from the Health screen.

import { esc, todayStr, msg } from "../ui.js";
import { api, errText } from "../api.js";

export async function render(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/extras?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const m = r.data.mental;
  el.innerHTML = `
    <p class="sub">${m.kid ? "Game-day tricks to feel brave and have fun." : "Short routines the best players use. Pick one and practice it this week."}</p>
    ${m.skills.map((s) => `<details class="card skill" ${s.id === "routine" ? "open" : ""}><summary><b>${esc(s.title)}</b><div class="rowsub">${esc(s.when)}</div></summary>
      <ol class="hsteps">${s.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></details>`).join("")}
    <button class="btn ghost block" data-act="nav" data-to="#/health">Breathing exercises</button>`;
}
export const actions = {};
