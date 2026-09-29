// Trends: readiness line, sleep bars, weekly load bars, 7-day averages.
// Single-series charts: one data color (lime), recessive hairline grid,
// text in text tokens, hover/tap tooltips, and a table view for every chart.

import { esc, todayStr, niceDate } from "../ui.js";
import { api, errText } from "../api.js";

const W = 340, H = 150, PADL = 30, PADR = 8, PADT = 10, PADB = 22;
const DATA = "var(--lime)", GRID = "var(--line)", AXIS = "var(--dim)";

function frame(ticks, y, fmt) {
  return ticks.map((t) => `<line x1="${PADL}" x2="${W - PADR}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}" stroke-width="1"/>
    <text x="${PADL - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="${AXIS}">${fmt(t)}</text>`).join("");
}
function xLabels(days, x) {
  const idx = [0, Math.floor(days.length / 2), days.length - 1];
  return idx.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}" font-size="10" fill="${AXIS}">${esc(niceDate(days[i].date, { month: "short", day: "numeric" }))}</text>`).join("");
}
function hits(n, x, step, tips) {
  return Array.from({ length: n }, (_, i) => `<rect x="${x(i) - step / 2}" y="${PADT}" width="${step}" height="${H - PADT - PADB}" fill="transparent" data-tip="${esc(tips[i])}" data-x="${x(i)}"/>`).join("");
}

function lineChart(days, key, { min, max, ticks, fmt, unit }) {
  const n = days.length, step = (W - PADL - PADR) / (n - 1);
  const x = (i) => PADL + i * step;
  const y = (v) => PADT + (1 - (v - min) / (max - min)) * (H - PADT - PADB);
  let d = "", pen = false;
  days.forEach((p, i) => {
    const v = p[key];
    if (v === null || v === undefined) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true;
  });
  const pts = days.map((p, i) => (p[key] === null ? "" : `<circle cx="${x(i)}" cy="${y(p[key])}" r="4" fill="${DATA}" stroke="var(--panel)" stroke-width="2"/>`)).join("");
  const tips = days.map((p) => `${niceDate(p.date)}: ${p[key] === null ? "no check-in" : p[key] + (unit || "")}`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${frame(ticks, y, fmt)}${xLabels(days, x)}
    <path d="${d}" fill="none" stroke="${DATA}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${pts}${hits(n, x, step, tips)}</svg>`;
}

function barChart(items, { max, ticks, fmt, label, tip, ref }) {
  const n = items.length, slot = (W - PADL - PADR) / n, bw = Math.min(24, slot - 2);
  const x = (i) => PADL + slot * i + slot / 2;
  const y = (v) => PADT + (1 - v / max) * (H - PADT - PADB);
  const base = y(0);
  const bars = items.map((it, i) => {
    const v = it.v; if (!v) return "";
    const top = y(Math.min(v, max)), h = base - top, r = Math.min(4, h);
    // Rounded data-end, square at the baseline.
    return `<path d="M${x(i) - bw / 2},${base} V${top + r} Q${x(i) - bw / 2},${top} ${x(i) - bw / 2 + r},${top} H${x(i) + bw / 2 - r} Q${x(i) + bw / 2},${top} ${x(i) + bw / 2},${top + r} V${base} Z" fill="${DATA}"/>`;
  }).join("");
  const refLine = ref ? `<line x1="${PADL}" x2="${W - PADR}" y1="${y(ref.v)}" y2="${y(ref.v)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="0"/>
    <text x="${W - PADR}" y="${y(ref.v) - 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(ref.label)}</text>` : "";
  const labels = label ? items.map((it, i) => (n <= 6 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="${AXIS}">${esc(it.label)}</text>` : "")).join("") : "";
  const xl = !label ? xLabels(items.map((it) => ({ date: it.date })), x) : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${frame(ticks, y, fmt)}${bars}${refLine}${labels}${xl}${hits(n, x, slot, items.map(tip))}</svg>`;
}

function tipLayer(root) {
  root.querySelectorAll(".chart").forEach((c) => {
    const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; c.appendChild(tip);
    const show = (ev) => {
      const t = ev.target.closest("[data-tip]");
      if (!t) { tip.hidden = true; return; }
      const svg = c.querySelector("svg"), scale = svg.getBoundingClientRect().width / W;
      tip.textContent = t.dataset.tip; tip.hidden = false;
      tip.style.left = `${Number(t.dataset.x) * scale}px`; tip.style.top = `${PADT * scale + 8}px`;
    };
    c.addEventListener("pointermove", show); c.addEventListener("pointerdown", show);
    c.addEventListener("pointerleave", () => (tip.hidden = true));
  });
}

const LOAD_PILL = { spike: ["low", "Spike"], high: ["moderate", "Heavy week"], steady: ["ready", "In range"], low: ["neutral", "Light week"], not_enough_data: ["neutral", "Building history"] };

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/trends?date=${todayStr()}&days=28`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  const t = r.data;
  const any = t.days.some((d) => d.readiness !== null || d.sleep !== null);
  if (!any) {
    el.innerHTML = `<div class="card empty"><div class="big">Your trends start here</div><p>Check in each morning. After a few days you will see sleep, readiness and training load build up.</p>
      <button class="btn primary" data-act="nav" data-to="#/checkin">Check in now</button></div>`;
    return;
  }
  const a = t.averages7, L = t.load, [pc, pl] = LOAD_PILL[L.status];
  const fmtN = (v, u = "") => (v === null ? "–" : `${v}${u}`);
  const table = (rows, cols) => `<details class="table"><summary>Show as table</summary><table class="data"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">Readiness</div><div class="v">${fmtN(a.readiness)}</div><div class="u">7-day average</div></div>
      <div class="stat"><div class="k">Sleep</div><div class="v">${fmtN(a.sleep)}<span class="u"> h</span></div><div class="u">7-day average</div></div>
      <div class="stat"><div class="k">Soreness</div><div class="v">${fmtN(a.soreness)}<span class="u">/10</span></div><div class="u">7-day average</div></div>
      <div class="stat"><div class="k">Streak</div><div class="v">${t.checkinStreak}</div><div class="u">days in a row</div></div>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Readiness, last 28 days</h3>
      <div class="chart">${lineChart(t.days, "readiness", { min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => v })}</div>
      ${table(t.days.filter((d) => d.readiness !== null).map((d) => [niceDate(d.date), d.readiness]), ["Day", "Readiness"])}
    </div>

    <div class="card">
      <h3>Sleep (hours)</h3>
      <div class="chart">${barChart(t.days.map((d) => ({ v: d.sleep, date: d.date })), { max: 12, ticks: [0, 4, 8, 12], fmt: (v) => v, ref: { v: 8, label: "8 h" }, tip: (it) => `${niceDate(it.date)}: ${it.v === null ? "no check-in" : it.v + " h"}` })}</div>
      ${table(t.days.filter((d) => d.sleep !== null).map((d) => [niceDate(d.date), d.sleep + " h"]), ["Day", "Sleep"])}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3 style="margin:0">Training load by week</h3><span class="pill ${pc}"><span class="dot"></span>${pl}</span>
      </div>
      <p class="rowsub">${esc(L.message)}${L.ratio !== null ? ` This week vs. your average: ${L.ratio}x.` : ""}</p>
      ${(() => { const mx = Math.max(100, ...t.weeklyLoads.map((w) => w.load)); const top = Math.ceil(mx / 500) * 500;
        return `<div class="chart">${barChart(t.weeklyLoads.map((w, i) => ({ v: w.load, label: i === 3 ? "This wk" : `${3 - i} wk ago` })), { max: top, ticks: [0, top / 2, top], fmt: (v) => (v >= 1000 ? v / 1000 + "k" : v), label: true, tip: (it) => `${it.label}: ${it.v} load` })}</div>`; })()}
      <p class="hint">Load = minutes x effort (1-10) from your check-ins.</p>
      ${table(t.weeklyLoads.map((w) => [niceDate(w.weekStart), w.load]), ["Week starting", "Load"])}
    </div>`;
  tipLayer(el);
}

export const actions = {};
