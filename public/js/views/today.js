// Today: day type, countdown, readiness, daily targets, focus, next reminders.

import { esc, todayStr, nowStr, to12, relDay, untilText, icon } from "../ui.js";
import { api, errText } from "../api.js";

export function readinessRing(score, status) {
  const r = 36, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, score)) / 100;
  const col = status === "ready" ? "var(--good)" : status === "moderate" ? "var(--warn)" : "var(--bad)";
  return `<div class="ring" role="img" aria-label="Readiness ${score} out of 100">
    <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--line2)" stroke-width="8"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}"/></svg>
    <div class="val">${score}</div></div>`;
}

export function statusPill(readiness) {
  if (!readiness) return `<span class="pill neutral"><span class="dot"></span>No check-in</span>`;
  return `<span class="pill ${readiness.status}"><span class="dot"></span>${esc(readiness.label)}</span>`;
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/today?date=${todayStr()}&now=${encodeURIComponent(nowStr())}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  const t = r.data;

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const nm = t.nextMatch;
  const countdown = nm
    ? `<div class="countdown">${nm.daysAway === 0 ? "Kickoff" : "Next game"} ${nm.daysAway === 0 ? "in" : ""} <b>${nm.daysAway === 0 ? esc(untilText(`${nm.date}T${nm.time}`)) : esc(relDay(nm.date))}</b> · ${esc(to12(nm.time))}</div>`
    : "";

  const ready = t.readiness
    ? `<div class="readyRow">${readinessRing(t.readiness.score, t.readiness.status)}
        <div><div>${statusPill(t.readiness)}</div>
        <div class="rowsub" style="margin-top:8px">${esc(t.readiness.advice[0])}</div></div></div>`
    : `<div class="readyRow"><div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="none" stroke="var(--line2)" stroke-width="8" stroke-dasharray="4 6"/></svg><div class="val dim">?</div></div>
        <div><b>How are you feeling?</b><div class="rowsub">A 30-second check-in tunes today's plan.</div>
        <button class="btn primary sm" style="margin-top:10px" data-act="nav" data-to="#/checkin">Check in</button></div></div>`;

  const tg = t.targets;
  const targets = `
    <div class="targets">
      <div class="tgt"><div class="k">Carbs</div><div class="v">${tg.carbsG[0]}-${tg.carbsG[1]}</div><div class="u">grams today</div></div>
      <div class="tgt"><div class="k">Protein</div><div class="v">${tg.proteinG[0]}-${tg.proteinG[1]}</div><div class="u">grams today</div></div>
      <div class="tgt"><div class="k">Fluids</div><div class="v">${tg.fluidsL} L</div><div class="u">about ${Math.round(tg.fluidsL * 33.8)} oz</div></div>
    </div>
    <p class="rowsub" style="margin:10px 0 0">${esc(tg.note)}</p>`;

  const events = t.todaysEvents.length
    ? t.todaysEvents.map((e) => `<li><span class="time">${esc(to12(e.time))}</span><div><span class="kind ${e.type}">${e.type === "training" ? "practice" : esc(e.type)}</span>${e.conditions ? ` <span class="rowsub">${esc(e.conditions)}</span>` : ""}</div></li>`).join("")
    : "";

  const rem = (t.reminders || []).slice(0, 4);
  const nextUp = rem.length
    ? `<ul class="list">${rem.map((x) => `<li><span class="time">${esc(to12(x.at.slice(11)))}</span><div><div class="rowtitle">${esc(x.title)}</div><div class="rowsub">${esc(x.body)}</div></div></li>`).join("")}</ul>`
    : `<p class="muted" style="margin:0">Nothing else scheduled today. Rest up.</p>`;

  const tiles = [];
  if (t.dayType === "match" || t.dayType === "match_eve") tiles.push(["gameday", "ball", "Game-day plan", "Hour-by-hour fueling for your game"]);
  if (t.dayType === "recovery" || t.tournament) tiles.push(["recovery", "recover", "Recovery plan", "Day-by-day refuel and rest"]);
  tiles.push(["schedule", "calendar", "Schedule", "Add games and practices"]);

  el.innerHTML = `
    <section class="hero">
      <div class="greet">${greet}, ${esc(t.firstName)}</div>
      <div class="headline">${esc(t.headline)}</div>
      <div class="note">${esc(t.focus[0] || "")}</div>
      ${countdown}
    </section>

    <div class="card">${ready}</div>

    <div class="card">
      <h3>Today's targets</h3>
      ${targets}
    </div>

    ${events ? `<div class="card"><h3>On the schedule</h3><ul class="list">${events}</ul></div>` : ""}

    <div class="card">
      <h3>Focus</h3>
      <ul class="list">${t.focus.slice(1).map((f) => `<li><span class="bullet"></span><div>${esc(f)}</div></li>`).join("")}</ul>
    </div>

    <div class="card">
      <h3>Next up</h3>
      ${nextUp}
    </div>

    ${tiles.map(([to, ic, a, b]) => `<button class="tile" data-act="nav" data-to="#/${to}"><span class="ic">${icon(ic)}</span><span><div class="tt">${a}</div><div class="ts">${b}</div></span><span class="chev">›</span></button>`).join("")}

    <p class="disc">${esc(t.disclaimer)}</p>`;
}

export const actions = {};
