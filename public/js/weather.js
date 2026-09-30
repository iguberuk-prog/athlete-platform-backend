// Weather card used on Today and Game Day.

import { esc, to12 } from "./ui.js";

const FLAG_LABEL = { green: "Green flag", yellow: "Yellow flag", orange: "Orange flag", red: "Red flag", black: "Black flag" };
const COLD_LABEL = { cool: "Cool", cold: "Cold", very_cold: "Very cold", extreme: "Extreme cold" };

export function flagPill(c) {
  if (c.alerts?.some((a) => /thunder|tornado|lightning/i.test(a.event)) || (c.thunderPct ?? 0) >= 40) return `<span class="flag red">Storms</span>`;
  if (c.air && !["good", "moderate"].includes(c.air)) return `<span class="flag orange">Air quality</span>`;
  if (c.heat && c.heat !== "green") return `<span class="flag ${c.heat}">${FLAG_LABEL[c.heat]}</span>`;
  if (c.cold && c.cold !== "none") return `<span class="flag coldf">${COLD_LABEL[c.cold]}</span>`;
  return `<span class="flag green">Comfortable</span>`;
}

/** Full card for one plan. `title` e.g. "Game at 3:00 PM". */
export function weatherCard(plan, title, opts = {}) {
  if (!plan) return "";
  const c = plan.conditions;
  const calm = plan.severity === "none";
  return `<div class="card wx ${calm ? "" : "wx-" + (c.heat && c.heat !== "green" ? "hot" : "cold")}">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div><h3 style="margin:0 0 4px">${esc(title)}</h3>
        <div class="rowtitle">${esc(c.headline || "")}</div>
        <div class="rowsub">${esc(c.place || "ZIP " + c.zip)}${c.maxWbgtF != null ? ` · WBGT ${c.maxWbgtF}°F` : ""}</div></div>
      ${flagPill(c)}
    </div>
    ${plan.warnings.map((w) => `<div class="warnbox" style="margin:10px 0 0">${esc(w)}</div>`).join("")}
    ${calm ? `<p class="rowsub" style="margin:10px 0 0">No weather changes needed. Normal plan.</p>` : `
      <ul class="list" style="margin-top:10px">${plan.actions.slice(0, opts.all ? 8 : 3).map((a) => `<li><span class="bullet"></span><div>${esc(a)}</div></li>`).join("")}</ul>
      ${plan.packing.length ? `<div class="rowsub" style="margin-top:8px"><b>Pack:</b> ${esc(plan.packing.join(", "))}</div>` : ""}`}
  </div>`;
}

export { to12 };
