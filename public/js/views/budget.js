// Season budget: what soccer costs this season.

import { $, esc, todayStr, niceDate, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender } from "../app.js";

const CATS = [["club_fees", "Club fees"], ["tournaments", "Tournaments"], ["travel", "Travel and hotels"], ["gear", "Gear and uniforms"], ["training", "Private training and camps"], ["food", "Food on the road"], ["medical", "Physio and medical"], ["other", "Other"]];
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export async function render(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/budget?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const b = r.data;
  el.innerHTML = `
    <section class="hero"><div class="greet">Season ${esc(b.from.slice(0, 4))}-${esc(b.to.slice(2, 4))}</div><div class="headline">${money(b.total)}</div>
      <div class="note">${b.plan ? `${money(b.left)} left of ${money(b.plan)}` : "No budget set"}</div></section>
    ${b.plan ? `<div class="bar big"><i style="width:${Math.min(100, Math.round((b.total / b.plan) * 100))}%;${b.total > b.plan ? "background:var(--bad)" : ""}"></i></div>` : ""}
    <form class="card" data-submit="bAdd" novalidate><h3>Add a cost</h3>
      <div class="row2"><input class="input" id="bAmt" inputmode="decimal" placeholder="Amount ($)"><input class="input" id="bDate" type="date" value="${todayStr()}"></div>
      <select class="input" id="bCat" style="margin-top:8px">${CATS.map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select>
      <input class="input" id="bNote" placeholder="Note (optional)" maxlength="120" style="margin-top:8px">
      <div class="actions"><button class="btn primary block">Add</button></div></form>
    ${b.byCategory.length ? `<div class="card"><h3>Where it goes</h3><table class="data"><tbody>${b.byCategory.map((c) => `<tr><td>${esc(c.label)}</td><td><b>${money(c.total)}</b> <span class="dim">${c.share}%</span></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${b.expenses.length ? `<div class="card"><h3>All costs</h3>${b.expenses.map((x) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${money(x.amount)} · ${esc(CATS.find((c) => c[0] === x.category)?.[1] || x.category)}</div><div class="rowsub">${esc(niceDate(x.date))}${x.note ? ` · ${esc(x.note)}` : ""}</div></div><button class="btn ghost sm" data-act="bDel" data-id="${x.id}" aria-label="Delete">✕</button></div>`).join("")}</div>` : ""}
    <form class="card" data-submit="bPlan"><h3>Season budget</h3><div class="row2"><input class="input" id="bPlanAmt" inputmode="decimal" placeholder="e.g. 3500" value="${b.plan ?? ""}"><button class="btn ghost">Save</button></div></form>`;
}

export const actions = {
  async bAdd() {
    const amount = Number(String($("#bAmt").value).replace(/[$,]/g, ""));
    const r = await api(`/api/profiles/${active().id}/budget/expenses`, { method: "POST", body: { amount, date: $("#bDate").value, category: $("#bCat").value, note: $("#bNote").value || undefined } });
    if (!r.ok) return toast(errText(r));
    rerender();
  },
  async bDel(btn) { const r = await api(`/api/profiles/${active().id}/budget/expenses/${btn.dataset.id}`, { method: "DELETE" }); if (!r.ok) toast(errText(r)); rerender(); },
  async bPlan() {
    const v = String($("#bPlanAmt").value).replace(/[$,]/g, "");
    const r = await api(`/api/profiles/${active().id}/budget/plan`, { method: "PUT", body: { amount: v ? Number(v) : null } });
    toast(r.ok ? "Saved" : errText(r)); rerender();
  },
};
