// Grocery list: next 7 days, allergy-safe, tick items off, share.

import { esc, todayStr, niceDate, storeGet, storeSet, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender } from "../app.js";

let list = null;
const key = (p, from) => `grocery:${p}:${from}`;

export async function render(el, ctx) {
  const p = ctx.profile;
  const from = todayStr();
  const r = await api(`/api/profiles/${p.id}/grocery?from=${from}&days=7`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  list = r.data;
  const done = storeGet(key(p.id, from), {});
  const c = list.dayCounts;
  const n = p.nutrition;
  const avoid = [
    ...(n.allergies || []).map((a) => (a.allergen === "other" ? a.note || "other" : a.allergen)),
    ...(n.medicalDiets || []).map((m) => ({ celiac: "celiac", type1_diabetes: "type 1 diabetes", sensitive_stomach: "sensitive stomach", low_fodmap: "low-FODMAP" }[m] || m)),
    ...(n.dietaryRestrictions || []),
    ...(n.intolerances || []).map((i) => i + " intolerance"),
    ...(n.dislikes || []),
  ].map((x) => String(x).replace(/_/g, " "));

  el.innerHTML = `
    <section class="hero">
      <div class="greet">${esc(niceDate(list.from))} to ${esc(niceDate(list.to))}</div>
      <div class="headline">This week's list</div>
      <div class="note">${c.match} game day${c.match === 1 ? "" : "s"}, ${c.training} practice${c.training === 1 ? "" : "s"}, ${c.recovery} recovery, ${c.rest + c.match_eve} other days.</div>
    </section>
    ${avoid.length ? `<div class="card tight"><span class="small muted">Filtered for: </span><b class="small">${esc(avoid.join(", "))}</b></div>` : ""}
    ${list.sections.map((s, si) => `
      <div class="card">
        <h3>${esc(s.title)}</h3>
        ${s.items.map((it, ii) => {
          const id = `${si}-${ii}`, on = !!done[id];
          return `<label class="gitem ${on ? "done" : ""}"><input type="checkbox" data-act="gToggle" data-id="${id}" ${on ? "checked" : ""}>
            <span class="gn">${esc(it.name)}${it.why ? `<div class="rowsub">${esc(it.why)}</div>` : ""}</span><span class="ga">${esc(it.amount)}</span></label>`;
        }).join("")}
      </div>`).join("")}
    <div class="actions"><button class="btn primary" data-act="gShare">Share list</button><button class="btn ghost" data-act="gClear">Clear ticks</button></div>
    <p class="disc">${esc(list.note)} Weekly targets: about ${list.weeklyCarbsG.toLocaleString()} g carbs and ${list.weeklyProteinG.toLocaleString()} g protein. Always check labels for allergens.</p>`;
}

export const actions = {
  gToggle(input) {
    setTimeout(() => {
      const k = key(active().id, list.from);
      const done = storeGet(k, {}); done[input.dataset.id] = input.checked; storeSet(k, done);
      input.closest(".gitem").classList.toggle("done", input.checked);
    });
  },
  gClear() {
    storeSet(key(active().id, list.from), {}); rerender();
  },
  async gShare() {
    if (!list) return;
    const text = `Grocery list, ${niceDate(list.from)} to ${niceDate(list.to)}\n\n` +
      list.sections.map((s) => `${s.title}\n${s.items.map((i) => `- ${i.name}: ${i.amount}`).join("\n")}`).join("\n\n");
    if (navigator.share) { try { await navigator.share({ title: "Grocery list", text }); return; } catch { return; } }
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into a text or notes app."); } catch { toast("Couldn't copy on this device"); }
  },
};
