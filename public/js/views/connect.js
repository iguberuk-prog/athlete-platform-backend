// Connect team apps: sign in with TeamSnap or Google Calendar, or paste the
// calendar link from any other team app. Everything syncs every day.

import { $, $$, esc, msg, toast, icon, niceDate, to12 } from "../ui.js";
import { api, errText } from "../api.js";
import { active, loadProfiles, render as rerender, syncReminders } from "../app.js";

let data = null;
let openApp = null;
let picker = null; // { provider, items }

const KIND_TAG = { signin: "Sign in", link: "Calendar link", phone: "Through Google" };

export async function render(el, ctx) {
  const p = ctx.profile;
  if (ctx.query.connected || ctx.query.error) history.replaceState(null, "", "#/connect");
  if (ctx.query.connected) { toast(`${ctx.query.connected === "teamsnap" ? "TeamSnap" : "Google"} connected. Pick what to bring in.`); openApp = ctx.query.connected; }
  if (ctx.query.error) toast(ctx.query.error === "denied" ? "Sign-in was cancelled." : ctx.query.error === "expired" ? "That took too long. Try again." : "Sign-in didn't work. Try again.");
  const r = await api(`/api/profiles/${p.id}/connect`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  data = r.data;
  if (ctx.query.connected && !picker) loadOptions(ctx.query.connected);
  draw(el);
}

function feedRow(f) {
  const app = data.apps.find((a) => a.id === f.app);
  return `<div class="feed"><div style="flex:1;min-width:0"><div class="rowtitle">${esc(f.name || "Team calendar")}</div>
    <div class="rowsub">${app ? esc(app.name) + " · " : ""}${f.lastError ? `<span class="bad">${esc(f.lastError)}</span>` : f.lastSyncedAt ? `${f.eventCount ?? 0} events · synced ${esc(new Date(f.lastSyncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : "Not synced yet"}</div></div>
    <button class="btn ghost sm" data-act="cnRemoveFeed" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.name || "calendar")}">Remove</button></div>`;
}

function appDetail(a) {
  if (a.kind === "signin") {
    const c = a.connected;
    return `<div class="cnbox">
      ${!a.available ? `<div class="msg info">${esc(a.name)} sign-in isn't switched on yet.${a.id === "teamsnap" ? " Use the calendar link below for now." : ""}</div>` : ""}
      ${c ? `<div class="msg ok">Signed in${c.account ? ` as ${esc(c.account)}` : ""}.</div>
        <div class="actions"><button class="btn primary" data-act="cnOptions" data-p="${a.id}">${a.id === "teamsnap" ? "Choose teams" : "Choose calendars"}</button><button class="btn ghost" data-act="cnSignOut" data-p="${a.id}">Sign out</button></div>`
        : a.available ? `<ol class="hsteps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><button class="btn primary block" data-act="cnSignIn" data-p="${a.id}">Sign in with ${esc(a.name)}</button>` : ""}
      ${picker && picker.provider === a.id ? pickerHtml() : ""}
      ${a.note ? `<p class="small muted" style="margin-top:10px">${esc(a.note)}</p>` : ""}
      ${a.id === "teamsnap" ? linkForm(a) : ""}
    </div>`;
  }
  if (a.kind === "phone") {
    return `<div class="cnbox"><ol class="hsteps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <button class="btn primary block" data-act="cnOpen" data-id="google">Go to Google Calendar sign-in</button></div>`;
  }
  return `<div class="cnbox"><ol class="hsteps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${a.note ? `<p class="small muted">${esc(a.note)}</p>` : ""}${linkForm(a)}</div>`;
}

function linkForm(a) {
  return `<form data-submit="cnAddLink" data-app="${a.id}" class="cnform" novalidate>
    <label class="f" for="cnUrl-${a.id}">Paste the calendar link</label>
    <input class="input" id="cnUrl-${a.id}" placeholder="webcal://… or https://…" autocomplete="off" inputmode="url">
    <div class="row2" style="margin-top:8px"><input class="input" id="cnName-${a.id}" placeholder="Name (e.g. U14 Lions)" maxlength="60"><input class="input" id="cnZip-${a.id}" inputmode="numeric" maxlength="5" placeholder="Home field ZIP"></div>
    <button class="btn primary block" style="margin-top:8px">Add calendar</button></form>`;
}

function pickerHtml() {
  const g = picker.provider === "google";
  if (picker.loading) return `<p class="muted">Loading…</p>`;
  if (picker.error) return msg("err", picker.error);
  return `<form data-submit="cnChoose" class="picker">
    <div class="rowtitle" style="margin:12px 0 6px">${g ? "Which calendars have the games?" : "Which teams?"}</div>
    ${picker.items.map((it) => `<label class="check"><input type="checkbox" class="cnPick" value="${esc(it.id)}" data-name="${esc(it.name)}" ${it.picked ? "checked" : ""}><span><b>${esc(it.name)}</b>${it.sub ? ` <span class="muted">${esc(it.sub)}</span>` : ""}</span></label>`).join("") || `<p class="muted">Nothing found on this account.</p>`}
    ${g ? `<label class="f" for="cnKw">Only bring in events with these words</label><input class="input" id="cnKw" placeholder="soccer, U14, Lions" value="${esc(picker.keywords || "")}">
      <div class="hint">Leave blank to bring in anything that reads like a game, practice or tournament. Doctor visits and birthdays stay out.</div>` : ""}
    <button class="btn primary block" style="margin-top:10px">Bring in the schedule</button></form>`;
}

function draw(el = $("#view")) {
  const q = ($("#cnSearch")?.value || "").trim().toLowerCase();
  const feeds = data.feeds;
  const list = data.apps;
  const popular = list.filter((a) => a.popular), rest = list.filter((a) => !a.popular);
  const tile = (a) => `<div class="cnapp ${openApp === a.id ? "open" : ""}" data-name="${esc(a.name.toLowerCase())}">
    <button class="cnhead" data-act="cnOpen" data-id="${a.id}" aria-expanded="${openApp === a.id}"><span class="cnlogo" aria-hidden="true">${esc(a.name.slice(0, 1))}</span>
      <span style="flex:1;text-align:left"><b>${esc(a.name)}</b><div class="rowsub">${a.connected ? "Connected" : KIND_TAG[a.kind]}</div></span><span class="chev">${openApp === a.id ? "▾" : "›"}</span></button>
    ${openApp === a.id ? appDetail(a) : ""}</div>`;
  el.innerHTML = `
    <div class="card"><h3>Your team schedules</h3>
      ${feeds.length ? feeds.map(feedRow).join("") + `<div class="actions"><button class="btn ghost" data-act="cnSync">Sync now</button></div>` : `<p class="sub">Nothing connected yet. Pick your team app below. Games and practices come in on their own and update every day.</p>`}
      ${data.upcoming.length ? `<div class="rowsub" style="margin-top:10px">Coming up</div><ul class="list">${data.upcoming.map((e) => `<li><span class="bullet"></span><div>${esc(e.title || e.type)} · ${esc(niceDate(e.startTime.slice(0, 10)))}${e.startTime.length > 10 ? " " + esc(to12(e.startTime.slice(11, 16))) : ""}</div></li>`).join("")}</ul>` : ""}
    </div>
    <input class="input" id="cnSearch" placeholder="Search team apps" value="${esc(q)}" autocomplete="off" aria-label="Search team apps" style="margin-bottom:10px">
    ${popular.length ? `<div class="sectionTitle cn">Most used</div>${popular.map(tile).join("")}` : ""}
    ${rest.length ? `<div class="sectionTitle cn">More apps</div>${rest.map(tile).join("")}` : ""}
    <p class="disc">We never ask for another app's password. Sign-in happens on that app's own page, and you can disconnect any time.</p>`;
  const s = $("#cnSearch");
  const filter = () => { const v = s.value.trim().toLowerCase(); $$(".cnapp").forEach((t) => (t.hidden = !!v && !t.dataset.name.includes(v))); $$(".sectionTitle.cn").forEach((h) => (h.hidden = !!v)); };
  s.addEventListener("input", filter); filter();
}

async function loadOptions(provider) {
  picker = { provider, loading: true, items: [] };
  openApp = provider;
  if (data) draw();
  const r = await api(`/api/profiles/${active().id}/connect/${provider}/options`);
  picker = r.ok ? { provider, items: r.data.items, keywords: "soccer" } : { provider, error: errText(r), items: [] };
  draw();
}

async function done(r, text) {
  if (!r.ok) return toast(errText(r));
  toast(text);
  await loadProfiles(); await rerender(); syncReminders();
}

export const actions = {
  cnOpen(btn) { openApp = openApp === btn.dataset.id ? null : btn.dataset.id; draw(); },
  async cnSignIn(btn) {
    const r = await api(`/api/profiles/${active().id}/connect/${btn.dataset.p}/start`, { method: "POST", body: {} });
    if (!r.ok) return toast(errText(r));
    location.href = r.data.url;
  },
  cnOptions(btn) { loadOptions(btn.dataset.p); },
  async cnChoose() {
    const picks = $$(".cnPick:checked").map((b) => ({ id: b.value, name: b.dataset.name }));
    if (!picks.length) return toast("Pick at least one.");
    const keywords = ($("#cnKw")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    const r = await api(`/api/profiles/${active().id}/connect/${picker.provider}/choose`, { method: "POST", body: { picks, keywords } });
    picker = null;
    const n = r.ok ? (r.data.schedule.events || []).filter((e) => (r.data.schedule.feeds || []).some((f) => f.id === e.source && f.kind)).length : 0;
    await done(r, `Brought in ${n} games and practices`);
  },
  async cnSignOut(btn) {
    if (!confirm("Sign out and remove the games that came from it?")) return;
    picker = null;
    await done(await api(`/api/profiles/${active().id}/connect/${btn.dataset.p}`, { method: "DELETE" }), "Signed out");
  },
  async cnAddLink(form) {
    const a = form.dataset.app;
    const url = $(`#cnUrl-${a}`).value.trim();
    if (!url) return toast("Paste the calendar link first.");
    const r = await api(`/api/profiles/${active().id}/calendars`, { method: "POST", body: { url, name: $(`#cnName-${a}`).value.trim() || undefined, defaultZip: $(`#cnZip-${a}`).value.trim() || undefined } });
    const f = r.ok ? r.data.schedule.feeds.at(-1) : null;
    openApp = null;
    await done(r, f?.lastError ? `Added, but: ${f.lastError}` : `Added ${f?.eventCount ?? 0} games and practices`);
  },
  async cnSync() { await done(await api(`/api/profiles/${active().id}/calendars/sync`, { method: "POST" }), "Schedules synced"); },
  async cnRemoveFeed(btn) {
    if (!confirm("Remove this calendar and its games?")) return;
    await done(await api(`/api/profiles/${active().id}/calendars/${btn.dataset.id}`, { method: "DELETE" }), "Removed");
  },
};
