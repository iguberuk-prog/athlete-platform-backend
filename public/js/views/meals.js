// Meals: this week's plan, recipes, and what to order when eating out.

import { esc, todayStr, msg, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { render as rerender, state } from "../app.js";

const MEAL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", recovery: "Recovery" };
const TAG = { match: "Game day", match_eve: "Night before a game", recovery: "Recovery day", training: "Training day", rest: "Rest day" };
const list = (items) => `<ul class="list">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

function recipeCard(r) {
  return `<details class="table recipe"><summary><b>${esc(r.name)}</b> <span class="dim">· ${r.minutes} min</span></summary>
    <div class="rowsub" style="margin-top:6px">You need</div>
    <ul class="list">${r.ingredients.map((i) => `<li><span class="bullet"></span><div>${esc(i.name)} <span class="dim">${esc(i.qty)}</span></div></li>`).join("")}</ul>
    <div class="rowsub">Steps</div><ol class="hsteps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${r.swaps.length ? `<p class="disc">${esc(r.swaps.join(" "))}</p>` : ""}</details>`;
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const tab = ctx.sub || storeGet("mealsTab", "week");
  const r = await api(`/api/profiles/${p.id}/meals?from=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const { plan, eatingOut } = r.data;
  const tabs = [["week", "This week"], ["recipes", "Recipes"], ["out", "Eating out"]];
  el.innerHTML = `
    <div class="seg" role="tablist">${tabs.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" data-act="mealsTab" data-k="${k}">${t}</button>`).join("")}</div>
    ${tab === "week" ? plan.days.map((d) => `
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3 style="margin:0">${esc(d.label)}</h3><span class="pill">${esc(TAG[d.dayType])}</span></div>
        <p class="rowsub">${esc(d.note)}</p>
        ${d.meals.map((m) => `<div class="rowsub" style="margin-top:8px">${MEAL[m.meal]}</div>${recipeCard(m.recipe)}`).join("")}</div>`).join("") + `<div class="card">${list(plan.tips)}</div>`
    : tab === "recipes" ? `<div class="card"><p class="sub">Every recipe here fits ${esc(p.identity.fullName.split(" ")[0])}'s food rules.</p>${plan.recipes.map(recipeCard).join("")}</div>`
    : `<div class="card">${list(eatingOut.general)}</div>` + eatingOut.places.map((pl) => `
      <div class="card"><h3>${esc(pl.name)}</h3>
        ${pl.before.length ? `<div class="rowsub">Before a game</div>${list(pl.before)}` : ""}
        ${pl.after.length ? `<div class="rowsub">After a game</div>${list(pl.after)}` : ""}
        ${pl.ask.map((a) => `<div class="warnbox">${esc(a)}</div>`).join("")}</div>`).join("")}
    ${state.club?.sponsor ? `<div class="sponsor">Meal guide sponsored by ${state.club.sponsor.url ? `<a href="${esc(state.club.sponsor.url)}" target="_blank" rel="noopener sponsored">${esc(state.club.sponsor.name)}</a>` : esc(state.club.sponsor.name)}${state.club.sponsor.message ? `: ${esc(state.club.sponsor.message)}` : ""}</div>` : ""}
    <p class="disc">Always read labels. Brands change what's in their food.</p>`;
}

export const actions = {
  mealsTab(btn) { storeSet("mealsTab", btn.dataset.k); location.hash = "#/meals"; rerender(); },
};
