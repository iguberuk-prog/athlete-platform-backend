// My Program: the athlete's age program with their own numbers, plus the food-safety card.

import { esc } from "../ui.js";
import { api, errText } from "../api.js";

const list = (items) => `<ul class="list">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/program`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  const g = r.data, b = g.band, n = g.numbers, s = g.safety;
  const them = g.parentVoice ? g.firstName : "you";
  const welcome = ctx.query.welcome === "1";

  const safetyRows = [
    ...s.allergies.map((a) => `<li><div style="flex:1"><div class="rowtitle">${esc(a.allergen === "other" ? a.note : a.allergen.replace(/_/g, " "))} allergy</div>
      <div class="rowsub">${esc(a.severity)}${a.anaphylaxis ? " · anaphylaxis history" : ""}${a.epinephrine ? " · carries EpiPen" : ""}${a.avoidCrossContact ? " · avoiding may-contain" : ""}</div></div></li>`),
    ...s.medicalDiets.map((m) => `<li><div class="rowtitle">${esc({ celiac: "Celiac disease", type1_diabetes: "Type 1 diabetes", sensitive_stomach: "Sensitive stomach", low_fodmap: "Low-FODMAP" }[m] || m)}</div></li>`),
    ...s.diets.map((d) => `<li><div class="rowtitle">${esc(d.replace(/_/g, " "))}</div></li>`),
    ...s.intolerances.map((i) => `<li><div class="rowtitle">${esc(i)} intolerance</div></li>`),
  ];

  el.innerHTML = `
    ${welcome ? `<div class="msg ok" style="margin:0 0 14px">Profile saved. Here's ${g.parentVoice ? `${esc(g.firstName)}'s` : "your"} program.</div>` : ""}
    <section class="hero">
      <div class="greet">${esc(g.firstName)}${g.age !== null ? `, age ${g.age}` : ""}</div>
      <div class="headline">${esc(b.name)} program</div>
      <div class="note">Ages ${esc(b.ages)}. ${esc(b.tagline)}</div>
    </section>

    <div class="stats">
      <div class="stat"><div class="k">Sleep</div><div class="v">${n.sleepHours[0]}-${n.sleepHours[1]}<span class="u"> h</span></div><div class="u">Bed by ${esc(n.bedtimeForWake)} for a ${esc(n.wake)} wake-up</div></div>
      <div class="stat"><div class="k">Protein</div><div class="v" style="${b.targetsMode === "plates" ? "font-size:17px" : ""}">${esc(n.proteinPerMealText)}</div><div class="u">at each meal${b.targetsMode === "plates" ? "" : ", 4 times a day"}</div></div>
      <div class="stat"><div class="k">Fluids</div><div class="v">${n.fluidsBaseL}<span class="u"> L</span></div><div class="u">a day before training</div></div>
      <div class="stat"><div class="k">Warm-up</div><div class="v">${n.warmupMin}<span class="u"> min</span></div><div class="u">before every game</div></div>
    </div>

    <div class="card" style="margin-top:14px"><h3>What matters most now</h3>${list(b.focus)}</div>
    <div class="card"><h3>Fuel</h3>${list(b.fuel)}</div>
    <div class="card"><h3>Hydration</h3>${list(b.hydration)}</div>
    <div class="card"><h3>Sleep</h3>${list(b.sleep)}</div>
    <div class="card"><h3>Recovery</h3>${list(b.recovery)}</div>
    <div class="card">
      <h3>Rules for this age</h3>
      <ul class="list">
        <li><div style="flex:1"><div class="rowsub">During games</div><div>${esc(g.rules.inGame)}</div></div></li>
        <li><div style="flex:1"><div class="rowsub">Caffeine</div><div>${esc(g.rules.caffeine)}</div></div></li>
        <li><div style="flex:1"><div class="rowsub">Supplements</div><div>${esc(g.rules.supplements)}</div></div></li>
      </ul>
    </div>
    <div class="card"><h3>Avoid</h3>${list(b.avoid)}</div>
    <div class="card"><h3>When to see a doctor</h3>${list(b.watch)}</div>

    <div class="card" id="safety">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3 style="margin:0">Food safety</h3>
        <button class="btn ghost sm" data-act="nav" data-to="#/profile/edit?food=1">Edit</button>
      </div>
      ${s.confirmedAt ? "" : `<div class="warnbox" style="margin-top:10px">Not confirmed yet. Tap Edit and confirm at the bottom.</div>`}
      ${safetyRows.length ? `<ul class="list">${safetyRows.join("")}</ul>` : `<p class="muted">No allergies or diet restrictions on file.</p>`}
      ${s.warnings.map((w) => `<div class="warnbox">${esc(w)}</div>`).join("")}
      ${s.excluded.length ? `<details class="table"><summary>Foods we'll never suggest to ${esc(them)} (${s.excluded.length})</summary>
        <table class="data"><tbody>${s.excluded.map((e) => `<tr><td>${esc(e.name)}</td><td class="dim">${esc(e.why)}</td></tr>`).join("")}</tbody></table></details>` : ""}
    </div>

    ${g.nextProgram ? `<p class="muted small">Moves to the ${esc(g.nextProgram.name)} program (${esc(g.nextProgram.ages)}) at age ${g.nextProgram.atAge}. Plans update on their own.</p>` : ""}
    <details class="table"><summary>All seven programs</summary>
      <ul class="list">${g.allPrograms.map((x) => `<li><div style="flex:1"><div class="rowtitle">${esc(x.name)} · ${esc(x.ages)}${x.current ? " <span class='pill ready'>current</span>" : ""}</div><div class="rowsub">${esc(x.tagline)}</div></div></li>`).join("")}</ul>
    </details>
    <p class="disc">${esc(g.disclaimer)}</p>
    ${welcome ? `<div class="actions"><button class="btn primary block" data-act="nav" data-to="#/today">Go to today's plan</button></div>` : ""}`;
}

export const actions = {};
