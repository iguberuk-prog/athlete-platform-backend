// App entry: state, routing, tab bar, event delegation, reminder sync.

import { $, esc, icon, storeGet, storeSet, todayStr, nowStr, toast, avatar, loading } from "./ui.js";
import { initAuth, currentUser, api, onPasswordRecovery, signOut } from "./api.js";
import { isNative, post, onNative, scheduleInBrowser } from "./native.js";
import * as auth from "./views/auth.js";
import * as profile from "./views/profile.js";
import * as today from "./views/today.js";
import * as gameday from "./views/gameday.js";
import * as recovery from "./views/recovery.js";
import * as checkin from "./views/checkin.js";
import * as more from "./views/more.js";
import * as schedule from "./views/schedule.js";
import * as trends from "./views/trends.js";
import * as grocery from "./views/grocery.js";
import * as team from "./views/team.js";
import * as settings from "./views/settings.js";
import * as program from "./views/program.js";
import * as health from "./views/health.js";
import * as meals from "./views/meals.js";
import * as scan from "./views/scan.js";
import * as devices from "./views/devices.js";
import * as family from "./views/family.js";
import * as report from "./views/report.js";
import * as journal from "./views/journal.js";
import * as progress from "./views/progress.js";
import * as mind from "./views/mind.js";
import * as tournament from "./views/tournament.js";
import * as emergency from "./views/emergency.js";
import * as safesport from "./views/safesport.js";
import * as budget from "./views/budget.js";
import * as season from "./views/season.js";
import * as ask from "./views/ask.js";

export const state = {
  user: null,          // { email, role }
  profiles: [],
  activeId: null,
  route: { name: "today", sub: "", query: {} },
};

const VIEWS = {
  today, gameday, recovery, checkin, more, schedule, trends, grocery, team,
  profile, program, reminders: settings, account: settings,
  health, meals, scan, devices, family, report,
  journal, progress, mind, tournament, emergency, safesport, budget, season, ask,
};

// Views register click handlers by name; buttons carry data-act="name".
const actions = {};
for (const v of [auth, profile, today, gameday, recovery, checkin, more, schedule, trends, grocery, team, settings, program, health, meals, scan, devices, family, report, journal, progress, mind, tournament, emergency, safesport, budget, season, ask]) {
  Object.assign(actions, v.actions || {});
}

export const active = () => state.profiles.find((p) => p.id === state.activeId) || null;
export const isCoach = () => state.user?.role === "coach";
export const isParent = () => state.user?.role === "parent";

export function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

export function setActive(id) {
  state.activeId = id;
  storeSet("activeProfile", id);
}

export async function loadProfiles() {
  const r = await api("/api/profiles");
  if (r.status === 401) { state.user = null; return false; }
  state.profiles = r.ok ? r.data.profiles || [] : state.profiles;
  const saved = storeGet("activeProfile", null);
  if (!state.profiles.some((p) => p.id === state.activeId)) {
    state.activeId = state.profiles.some((p) => p.id === saved) ? saved : state.profiles[0]?.id || null;
  }
  return true;
}

function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const [path, qs = ""] = h.split("?");
  const [name = "", sub = ""] = path.split("/");
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { name, sub, query };
}

function tabsFor() {
  if (isCoach() && !state.profiles.length) {
    return [["team", "Team", "team"], ["schedule", "Schedule", "calendar"], ["more", "More", "more"]];
  }
  const t = [["today", "Today", "today"], ["gameday", "Game Day", "ball"], ["recovery", "Recovery", "recover"], ["checkin", "Check-in", "check"], ["more", "More", "more"]];
  return t;
}

const TITLES = {
  today: "Today", gameday: "Game Day", recovery: "Recovery", checkin: "Check-in", more: "More",
  schedule: "Schedule", trends: "Trends", grocery: "Grocery list", team: "Team", profile: "Profile",
  reminders: "Reminders", account: "Account", program: "My program",
  health: "Health", meals: "Meals", scan: "Scan food", devices: "Devices", family: "Family", report: "Weekly report",
  journal: "Journal", progress: "Progress", mind: "Mental skills", tournament: "Tournament", emergency: "Emergency card", safesport: "Safe sport", budget: "Season budget", season: "Season review", ask: "Ask",
};

function switcher() {
  if (state.profiles.length < 2 && !isParent()) return "";
  const chips = state.profiles.map((p) =>
    `<button class="pchip ${p.id === state.activeId ? "on" : ""}" data-act="switchProfile" data-id="${p.id}">${avatar(p)}${esc((p.identity.fullName || "").split(" ")[0])}</button>`,
  ).join("");
  const add = isParent() ? `<button class="pchip add" data-act="nav" data-to="#/profile/new">+ Add athlete</button>` : "";
  return `<div class="switcher" role="tablist" aria-label="Athletes">${chips}${add}</div>`;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const app = $("#app");
  state.route = parseHash();

  if (!state.user) {
    app.innerHTML = "";
    await auth.render(app, state.route);
    return;
  }

  let name = state.route.name;
  const needsProfile = !isCoach() && !state.profiles.length;
  if (needsProfile && !(name === "profile" && state.route.sub === "new") && !["account", "reminders"].includes(name)) {
    name = "profile"; state.route = { name, sub: "new", query: { first: "1" } };
  }
  if (!VIEWS[name]) { name = isCoach() && !state.profiles.length ? "team" : "today"; state.route.name = name; }
  // Screens that need a player profile.
  if (!active() && ["health", "meals", "scan", "devices", "report", "journal", "progress", "mind", "tournament", "emergency", "budget", "season", "ask"].includes(name)) { name = isCoach() ? "team" : "today"; state.route.name = name; }

  const tabs = needsProfile ? [] : tabsFor();
  const tabNames = tabs.map((t) => t[0]);
  const showSwitch = ["today", "gameday", "recovery", "checkin", "schedule", "trends", "grocery", "program", "health", "meals", "scan", "devices", "report", "journal", "progress", "mind", "tournament", "emergency", "budget", "season", "ask"].includes(name) ||
    (name === "team" && !isCoach());
  const titleText = name === "profile" && state.route.sub === "new"
    ? (isParent() ? "Add an athlete" : "Set up your profile")
    : TITLES[name] || "";

  app.innerHTML = `
    <header class="topbar">
      ${tabNames.includes(name) ? `<div class="mark" aria-hidden="true">A</div>` : `<button class="btn link sm" data-act="back" aria-label="Back">‹ Back</button>`}
      <h1>${esc(titleText)}</h1>
    </header>
    <div id="offline" class="offline" ${navigator.onLine ? "hidden" : ""}>Offline. Showing your last saved plan.</div>
    <main class="main ${tabs.length ? "" : "noTabs"}">
      ${showSwitch ? switcher() : ""}
      <div id="view">${loading()}</div>
    </main>
    ${tabs.length ? `<div class="tabbar"><nav style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map(([n, label, ic]) =>
      `<button class="tab ${n === name || (!tabNames.includes(name) && n === "more") ? "on" : ""}" data-act="nav" data-to="#/${n}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`).join("")}</nav></div>` : ""}
  `;
  window.scrollTo(0, 0);
  const view = $("#view");
  try {
    await VIEWS[name].render(view, { ...state.route, name, profile: active(), state, seq: () => seq === renderSeq });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="msg err">${esc(e.message || e)}</div>`;
  }
}

// ---- reminders: server builds them, the phone schedules them ----
export async function syncReminders() {
  const p = active();
  if (!p) return;
  const prefs = storeGet("reminderPrefs", {});
  const off = Object.entries(prefs).filter(([, v]) => v === false).map(([k]) => k).join(",");
  const r = await api(`/api/profiles/${p.id}/reminders?from=${todayStr()}&days=7&now=${encodeURIComponent(nowStr())}${off ? "&off=" + off : ""}`);
  if (!r.ok) return;
  const items = r.data.reminders || [];
  if (isNative()) post({ type: "reminders", profileId: p.id, name: p.identity.fullName, items });
  else scheduleInBrowser(items.filter((x) => x.at.startsWith(todayStr())));
  if (isNative()) syncWidgets(p).catch(() => {});
}

/** Countdown + emergency card for the iPhone lock-screen widgets. */
async function syncWidgets(p) {
  const [n, x] = await Promise.all([api(`/api/profiles/${p.id}/next?now=${encodeURIComponent(nowStr())}`), api(`/api/profiles/${p.id}/extras?date=${todayStr()}`)]);
  const next = n.ok ? n.data.next : null;
  const card = x.ok ? x.data.emergency : null;
  post({
    type: "widget",
    next: next ? { title: `${next.title} ${next.time}`, at: next.at, eatBy: next.eatBy, tip: next.tip } : null,
    card: card ? { name: card.name.split(" ")[0], line: card.lines.filter((l) => l.urgent).map((l) => `${l.label}: ${l.value}`).join(" ") || "No allergies on file." } : null,
  });
}

// ---- global actions ----
Object.assign(actions, {
  nav: (el) => go(el.dataset.to),
  back: () => (history.length > 1 ? history.back() : go("#/today")),
  switchProfile: async (el) => { setActive(el.dataset.id); await render(); syncReminders(); },
});

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === "A" || el.tagName === "BUTTON") ev.preventDefault();
  Promise.resolve(fn(el, ev)).catch((e) => { console.error(e); toast(e.message || "Something went wrong"); });
});
document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-change]");
  if (!el) return;
  const fn = actions[el.dataset.change];
  if (fn) Promise.resolve(fn(el, ev)).catch((e) => { console.error(e); toast(e.message || "Something went wrong"); });
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("form[data-submit]");
  if (!f) return;
  ev.preventDefault();
  const fn = actions[f.dataset.submit];
  if (fn) Promise.resolve(fn(f, ev)).catch((e) => { console.error(e); toast(e.message || "Something went wrong"); });
});

window.addEventListener("hashchange", render);
window.addEventListener("online", () => $("#offline")?.setAttribute("hidden", ""));
window.addEventListener("offline", () => $("#offline")?.removeAttribute("hidden"));

export async function afterSignIn() {
  state.user = await currentUser();
  if (!state.user) { render(); return; }
  await loadProfiles();
  if (!location.hash || location.hash === "#/" || location.hash.startsWith("#/login") || location.hash.startsWith("#/signup")) {
    location.hash = isCoach() && !state.profiles.length ? "#/team" : "#/today";
  }
  await render();
  syncReminders();
}

export async function logOut() {
  post({ type: "signout" });
  await signOut();
  state.user = null; state.profiles = []; state.activeId = null;
  try { const reg = await navigator.serviceWorker?.getRegistration(); reg?.active?.postMessage({ type: "clear-api-cache" }); } catch {}
  location.hash = "#/login";
  render();
}

async function boot() {
  const ok = await initAuth().catch(() => ({ ok: false }));
  if (!ok.ok) {
    $("#app").innerHTML = `<div class="auth"><div class="msg err">Sign-in is not configured yet. The site owner needs to add SUPABASE_ANON_KEY in Netlify.</div></div>`;
    return;
  }
  onNative("ready", () => syncReminders());
  // Arriving from a password-reset email: Supabase signs the user in from the
  // link (token in the URL fragment); we show "Set a new password" first.
  const resetting = new URLSearchParams(location.search).has("reset") || /type=recovery/.test(location.hash);
  onPasswordRecovery(() => { state.user = null; history.replaceState(null, "", "/#/reset"); render(); });
  if (resetting) {
    await currentUser(); // lets Supabase finish reading the link
    state.user = null;
    history.replaceState(null, "", "/#/reset");
    await render();
    return;
  }
  state.user = await currentUser();
  if (state.user) await afterSignIn(); else render();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot();
