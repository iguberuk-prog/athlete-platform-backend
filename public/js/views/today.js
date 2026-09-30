// Today: day type, countdown, readiness, daily targets, focus, next reminders.

import { esc, todayStr, nowStr, to12, relDay, untilText, icon, storeGet } from "../ui.js";
import { state } from "../app.js";
import { api, errText } from "../api.js";
import { weatherCard } from "../weather.js";
import { buddyCard } from "./fun.js";

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
  const [r, nx, pg, rk, bc] = await Promise.all([
    api(`/api/profiles/${p.id}/today?date=${todayStr()}&now=${encodeURIComponent(nowStr())}`),
    api(`/api/profiles/${p.id}/next?now=${encodeURIComponent(nowStr())}`),
    api(`/api/profiles/${p.id}/progress?date=${todayStr()}`),
    api(`/api/profiles/${p.id}/risk?date=${todayStr()}`),
    buddyCard(p).catch(() => ""),
  ]);
  if (!ctx.seq()) return;
  const next = nx.ok ? nx.data.next : null;
  const prog = pg.ok ? pg.data : null;
  const risk = rk.ok ? rk.data : null;
  const streak = prog?.streaks.find((x) => x.id === "checkin");
  const upNext = next && next.minutesAway <= 36 * 60 ? `<div class="card upnext">
      <div class="eyebrow">Next up</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h3 style="margin:0">${esc(next.title)} · ${esc(next.time)}</h3><b class="big" data-countdown="${esc(next.at)}">${esc(untilText(next.at))}</b></div>
      ${next.eatBy ? `<div class="pill ready" style="margin-top:8px"><span class="dot"></span>${esc(next.eatBy)}</div>` : ""}
      <p class="rowsub" style="margin:8px 0 0">${esc(next.tip)}</p></div>` : "";
  const cl = state.club;
  const clubStrip = `${storeGet("pendingJoin", "") ? `<button class="tile" data-act="nav" data-to="#/team"><span class="ic">+</span><span><div class="tt">Finish joining your team</div><div class="ts">Code ${esc(storeGet("pendingJoin", ""))} is ready to go.</div></span><span class="chev">›</span></button>` : ""}
    ${cl ? cl.fields.map((f) => `<div class="msg err" style="margin:0 0 10px"><b>${esc(f.name)} ${esc(f.status)}.</b> ${esc(f.note || "")}</div>`).join("") : ""}
    ${cl && cl.onCall.length ? `<a class="tile" href="tel:${esc(cl.onCall[0].phone.replace(/[^\d+]/g, ""))}" style="text-decoration:none"><span class="ic">${icon("heart")}</span><span><div class="tt">Athletic trainer on call: ${esc(cl.onCall[0].name)}</div><div class="ts">${esc(cl.onCall[0].location || "")} · tap to call</div></span><span class="chev">›</span></a>` : ""}`;
  const topStrip = clubStrip + bc + `${streak ? `<button class="streak" data-act="nav" data-to="#/progress">${icon("flame")} ${streak.current} day${streak.current === 1 ? "" : "s"}${prog.newest ? ` · New badge: ${esc(prog.newest)}` : ""}</button>` : ""}
    ${risk && risk.level !== "low" ? `<button class="tile" data-act="nav" data-to="#/progress" style="border-color:${risk.level === "high" ? "rgba(255,107,107,.6)" : "rgba(255,200,87,.5)"}"><span class="ic">!</span><span><div class="tt">${risk.level === "high" ? "High" : "Rising"} injury risk this week</div><div class="ts">${esc(risk.factors[0]?.text || "")}</div></span><span class="chev">›</span></button>` : ""}`;
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
  const plates = tg.mode === "plates";
  const targets = plates ? `
    <div class="plate"><div class="rowtitle">The plate today</div><div class="rowsub" style="margin-top:4px">${esc(tg.plate)}</div></div>
    <div class="targets" style="grid-template-columns:1fr 1fr;margin-top:10px">
      <div class="tgt"><div class="k">Meals</div><div class="v">3 + 2</div><div class="u">meals + snacks</div></div>
      <div class="tgt"><div class="k">Water</div><div class="v">${tg.fluidsL} L</div><div class="u">about ${Math.round(tg.fluidsL * 4.2)} cups</div></div>
    </div>
    <p class="rowsub" style="margin:10px 0 0">${esc(tg.note)}</p>` : `
    <div class="targets">
      <div class="tgt"><div class="k">Carbs</div><div class="v">${tg.carbsG[0]}-${tg.carbsG[1]}</div><div class="u">grams today</div></div>
      <div class="tgt"><div class="k">Protein</div><div class="v">${tg.proteinG[0]}-${tg.proteinG[1]}</div><div class="u">grams today</div></div>
      <div class="tgt"><div class="k">Fluids</div><div class="v">${tg.fluidsL} L</div><div class="u">about ${Math.round(tg.fluidsL * 33.8)} oz</div></div>
    </div>
    ${tg.mode === "guide" ? `<p class="rowsub" style="margin:10px 0 0"><b>Plate:</b> ${esc(tg.plate)} Grams are a rough guide during growth spurts.</p>` : ""}
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
  if (t.safety.epinephrine && (t.dayType === "match" || t.dayType === "training")) tiles.unshift(["program", "heart", "EpiPen in the bag?", "Pack it for every game and practice"]);
  tiles.push(["program", "user", `${t.program.name} program`, t.program.tagline]);
  tiles.push(["schedule", "calendar", "Schedule", "Add games and practices"]);

  el.innerHTML = `
    ${topStrip}
    ${t.safety.confirmed ? "" : `<button class="tile" data-act="nav" data-to="#/profile/edit?food=1" style="border-color:rgba(255,200,87,.5)"><span class="ic">!</span><span><div class="tt">Confirm food safety</div><div class="ts">Two minutes. Makes sure nothing we suggest causes a problem.</div></span><span class="chev">›</span></button>`}
    ${upNext}
    <section class="hero">
      <button class="progchip" data-act="nav" data-to="#/program">${esc(t.program.name)} · ${esc(t.program.ages)}</button>
      <div class="greet">${greet}${t.program.parentVoice ? "" : `, ${esc(t.firstName)}`}</div>
      <div class="headline">${t.program.parentVoice ? `${esc(t.firstName)}'s ` : ""}${esc(t.program.parentVoice ? t.headline.toLowerCase() : t.headline)}</div>
      <div class="note">${esc(t.focus[0] || "")}</div>
      ${countdown}
    </section>

    ${t.weather.events.length
      ? t.weather.events.map((e) => weatherCard(e.plan, `${e.type === "match" ? "Game" : "Practice"} at ${to12(e.time)}`)).join("")
      : t.weather.day && t.weather.day.severity !== "none" ? weatherCard(t.weather.day, "Weather today") : ""}
    ${t.weather.tomorrow.map((e) => weatherCard(e.plan, `Tomorrow's game at ${to12(e.time)}`)).join("")}
    ${t.weather.homeZip ? "" : `<button class="tile" data-act="nav" data-to="#/profile/edit"><span class="ic">°F</span><span><div class="tt">Add your ZIP code</div><div class="ts">Plans adjust for heat and cold at every game.</div></span><span class="chev">›</span></button>`}
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
