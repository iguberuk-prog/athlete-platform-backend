// Meals: "What can I make?" (recipes by age, kitchen and who's cooking),
// this week's plan, and what to order when eating out.

import { esc, todayStr, msg, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { render as rerender, state } from "../app.js";

const MEAL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", recovery: "Recovery" };
const TAG = { match: "Game day", match_eve: "Night before a game", recovery: "Recovery day", training: "Training day", rest: "Rest day" };
const EQUIP = [["microwave", "Microwave"], ["toaster", "Toaster"], ["blender", "Blender"], ["freezer", "Freezer"], ["stove", "Stovetop"], ["oven", "Oven"], ["knife", "Sharp knife"]];
const MODE = { alone: "On your own", together: "Cook together", parent: "Grown-up cooks" };
const list = (items) => `<ul class="list">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

const prefKey = () => `kitchen:${state.activeId}`;
const prefs = () => storeGet(prefKey(), { have: EQUIP.map(([k]) => k), who: "", max: 0, meal: "", batch: false });
const setPrefs = (p) => storeSet(prefKey(), p);

function qs(p, forPlan = false) {
  const q = new URLSearchParams();
  q.set("have", p.have.length ? p.have.join(",") : "none");
  if (p.who) q.set("who", p.who);
  if (!forPlan) {
    if (p.max) q.set("max", p.max);
    if (p.meal) q.set("meal", p.meal);
    if (p.batch) q.set("batch", "1");
  }
  return q.toString();
}

function recipeCard(r, open = false) {
  const mode = r.mode === "alone" ? "ready" : r.mode === "together" ? "moderate" : "neutral";
  return `<details class="rcard" ${open ? "open" : ""}><summary><b>${esc(r.name)}</b>
      <div class="rowsub">${esc(r.label)} · ${r.minutes} min · serves ${r.serves}${r.batch ? " · batch cook" : ""}</div>
      <span class="pill ${mode}"><span class="dot"></span>${MODE[r.mode]}</span></summary>
    <div class="rowsub" style="margin-top:8px">You need</div>
    <ul class="list">${r.ingredients.map((i) => `<li><span class="bullet"></span><div>${esc(i.name)} <span class="dim">${esc(i.qty)}</span>${i.sponsored ? `<div class="small dim">Try: ${i.sponsored.url ? `<a href="${esc(i.sponsored.url)}" target="_blank" rel="noopener sponsored">${esc(i.sponsored.brand)} ${esc(i.sponsored.product)}</a>` : `${esc(i.sponsored.brand)} ${esc(i.sponsored.product)}`} · Sponsored</div>` : ""}</div></li>`).join("")}</ul>
    <div class="rowsub">Steps</div>
    <ol class="hsteps">${r.steps.map((s) => `<li>${s.who === "grown-up" && r.mode === "together" ? `<span class="who">Grown-up</span> ` : ""}${esc(s.text)}</li>`).join("")}</ol>
    ${r.kidTip ? `<div class="msg info" style="margin:8px 0 0">${esc(r.kidTip)}</div>` : ""}
    ${r.swaps.length ? `<p class="disc">${esc(r.swaps.join(" "))}</p>` : ""}</details>`;
}

async function recipesTab(p) {
  const pr = prefs();
  const r = await api(`/api/profiles/${p.id}/recipes?${qs(pr)}`);
  if (!r.ok) return msg("err", errText(r));
  const b = r.data, c = b.cook;
  const who = pr.who || b.who;
  const first = esc(p.identity.fullName.split(" ")[0]);
  const whoOpts = [["alone", c.id === "little" || c.id === "junior" ? `${first} on their own` : "On my own"], ["together", "Cook together"], ["parent", "Grown-up cooks"]];
  const chip = (act, v, on, text) => `<button class="chip ${on ? "on" : ""}" data-act="${act}" data-v="${v}">${text}</button>`;
  return `
    <div class="card cookcard">
      <div class="eyebrow">${esc(c.title)} · ages ${esc(c.ages)}</div>
      <h3 style="margin:4px 0">What can ${c.id === "little" || c.id === "junior" ? first : "you"} make?</h3>
      <details><summary class="small">What ${c.id === "little" || c.id === "junior" ? first + " can do" : "you can do"} at this age</summary>
        <div class="rowsub" style="margin-top:6px">On ${c.id === "little" || c.id === "junior" ? "their" : "your"} own</div>${list(c.can)}
        ${c.withGrownUp.length ? `<div class="rowsub">With a grown-up</div>${list(c.withGrownUp)}` : ""}
        <div class="rowsub">Kitchen rules</div>${list(c.rules)}</details>
      <label class="f">Who's cooking?</label>
      <div class="chips">${whoOpts.map(([k, t]) => chip("mWho", k, who === k, t)).join("")}</div>
      <label class="f">What's in your kitchen?</label>
      <div class="chips">${EQUIP.map(([k, t]) => chip("mHave", k, pr.have.includes(k), `${t}${b.unlocks[k] ? ` <span class="dim">${b.unlocks[k]}</span>` : ""}`)).join("")}</div>
      <label class="f">How much time?</label>
      <div class="chips">${[[0, "Any"], [10, "10 min"], [20, "20 min"], [45, "45 min"]].map(([k, t]) => chip("mMax", k, (pr.max || 0) === k, t)).join("")}</div>
      <label class="f">Meal</label>
      <div class="chips">${[["", "Any"], ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]].map(([k, t]) => chip("mMeal", k, (pr.meal || "") === k, t)).join("")}
        ${c.id === "home" || c.id === "cook" ? chip("mBatch", pr.batch ? 0 : 1, pr.batch, "Batch cook for the week") : ""}</div>
    </div>
    <p class="sub">${b.recipes.length} recipe${b.recipes.length === 1 ? "" : "s"} fit${b.recipes.length === 1 ? "s" : ""} ${first}'s food rules and your choices.${who === "alone" && b.counts.together > b.counts.alone ? ` ${b.counts.together - b.counts.alone} more if you cook together.` : ""}</p>
    ${b.recipes.map((x) => recipeCard(x)).join("") || `<div class="card empty"><p>Nothing matches. Try adding kitchen tools or more time.</p></div>`}`;
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const tab = ["make", "week", "out"].includes(ctx.sub) ? ctx.sub : storeGet("mealsTab", "make");
  const tabs = [["make", "What can I make?"], ["week", "This week"], ["out", "Eating out"]];
  let body;
  if (tab === "make") body = await recipesTab(p);
  else {
    const r = await api(`/api/profiles/${p.id}/meals?from=${todayStr()}&${qs(prefs(), true)}`);
    if (!r.ok) body = msg("err", errText(r));
    else {
      const { plan, eatingOut } = r.data;
      body = tab === "week"
        ? plan.days.map((d) => `
          <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3 style="margin:0">${esc(d.label)}</h3><span class="pill">${esc(TAG[d.dayType])}</span></div>
            <p class="rowsub">${esc(d.note)}</p>
            ${d.meals.map((m) => `<div class="rowsub" style="margin-top:8px">${MEAL[m.meal]}</div>${recipeCard(m.recipe)}`).join("")}</div>`).join("") + `<div class="card">${list(plan.tips)}<p class="disc">The plan uses your kitchen and cooking choices from "What can I make?".</p></div>`
        : `<div class="card">${list(eatingOut.general)}</div>` + eatingOut.places.map((pl) => `
          <div class="card"><h3>${esc(pl.name)}</h3>
            ${pl.before.length ? `<div class="rowsub">Before a game</div>${list(pl.before)}` : ""}
            ${pl.after.length ? `<div class="rowsub">After a game</div>${list(pl.after)}` : ""}
            ${pl.ask.map((a) => `<div class="warnbox">${esc(a)}</div>`).join("")}</div>`).join("");
    }
  }
  if (!ctx.seq()) return;
  el.innerHTML = `
    <div class="seg scroll" role="tablist">${tabs.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" data-act="mealsTab" data-k="${k}">${t}</button>`).join("")}</div>
    ${body}
    ${state.club?.sponsor ? `<div class="sponsor">Meal guide sponsored by ${state.club.sponsor.url ? `<a href="${esc(state.club.sponsor.url)}" target="_blank" rel="noopener sponsored">${esc(state.club.sponsor.name)}</a>` : esc(state.club.sponsor.name)}${state.club.sponsor.message ? `: ${esc(state.club.sponsor.message)}` : ""}</div>` : ""}
    <p class="disc">Always read labels. Brands change what's in their food.</p>`;
}

const update = (fn) => { const p = prefs(); fn(p); setPrefs(p); rerender(); };

export const actions = {
  mealsTab(btn) { storeSet("mealsTab", btn.dataset.k); location.hash = "#/meals"; rerender(); },
  mWho: (btn) => update((p) => { p.who = btn.dataset.v; }),
  mHave: (btn) => update((p) => { p.have = p.have.includes(btn.dataset.v) ? p.have.filter((x) => x !== btn.dataset.v) : [...p.have, btn.dataset.v]; }),
  mMax: (btn) => update((p) => { p.max = Number(btn.dataset.v); }),
  mMeal: (btn) => update((p) => { p.meal = btn.dataset.v; }),
  mBatch: (btn) => update((p) => { p.batch = btn.dataset.v === "1"; }),
};
