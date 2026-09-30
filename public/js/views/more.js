// More: profile card plus every secondary screen.

import { esc, icon, avatar } from "../ui.js";
import { isNative } from "../native.js";
import { state, isCoach, isParent, logOut } from "../app.js";
import { SPORTS } from "./profile.js";

let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Extra words people might type, so search finds the right screen.
const KW = {
  "#/connect": "teamsnap sportsengine playmetrics gamechanger leagueapps gotsport calendar sync import schedule link google spond band",
  "#/schedule": "games practice calendar add event match training",
  "#/meals": "recipes cook cooking food dinner lunch breakfast snack eat meal plan restaurant eating out",
  "#/scan": "barcode product label qr camera",
  "#/fun": "quiz sticker buddy playlist spotify music story wrapped cook night grocery hunt game kids",
  "#/invite": "share friend refer referral text sms email qr download app teammate",
  "#/health": "injury concussion asthma warmup warm-up period cycle sick soreness growth heat",
  "#/emergency": "epipen allergy contact 911 medical card",
  "#/profile/edit?food=1": "allergy allergies diet vegetarian vegan gluten dairy nuts kosher halal",
  "#/profile/edit": "edit profile name birthday weight height position level delete player",
  "#/grocery": "shopping list store",
  "#/progress": "streak badge points risk injury freeze",
  "#/journal": "stats goals game log reflection",
  "#/program": "age sleep protein hydration water",
  "#/tournament": "cooler hotel between games",
  "#/budget": "money cost fees expense",
  "#/family": "parent link share account kid",
  "#/club": "director coach trainer club",
  "#/team": "join code coach roster team",
  "#/reminders": "notifications alerts nudges",
  "#/account": "password delete email logout sign out",
  "#/season": "pdf review print",
  "#/mind": "nerves confidence mental breathing",
  "#/ask": "question chat help",
  "#/devices": "whoop oura garmin apple health watch wearable",
  "#/experts": "dietitian nutritionist camp",
  "#/trends": "chart graph sleep readiness load",
  "#/today": "home plan today morning",
  "#/gameday": "game day kickoff timeline match",
  "#/recovery": "recovery after game rest",
  "#/checkin": "check in how i feel sleep soreness mood",
};
const tile = (to, ic, a, b, extra = "") =>
  `<button class="tile ${extra}" data-act="nav" data-to="${to}" data-k="${esc(KW[to] || "")}"><span class="ic">${icon(ic)}</span><span><div class="tt">${a}</div><div class="ts">${b}</div></span><span class="chev">›</span></button>`;

export async function render(el, ctx) {
  const p = ctx.profile;
  const head = p ? `
    ${p.shared ? `<div class="msg info" style="margin:0 0 10px">Shared with you by family link. Only the owner can edit this profile.</div>` : ""}
    <div class="card" style="display:flex;gap:14px;align-items:center">
      ${avatar(p, "lg")}
      <div style="flex:1;min-width:0"><div class="rowtitle" style="font-size:17px">${esc(p.identity.fullName)}</div>
        <div class="rowsub">${esc(SPORTS[p.sport.primarySport]?.label || p.sport.primarySport)} · ${esc((p.sport.positions || []).join(", ").replace(/_/g, " "))}</div>
        <div class="rowsub">${esc(p.identity.playerCode || "")}</div></div>
      ${p.shared ? "" : `<button class="btn ghost sm" data-act="nav" data-to="#/profile/edit">Edit</button>`}
    </div>` : "";

  const install = !isNative() && !standalone() ? `
    <div class="card">
      <h3>Put it on your home screen</h3>
      ${installEvt ? `<button class="btn primary block" data-act="install">Install the app</button>`
        : isIOS() ? `<p class="sub" style="margin:0">In Safari, tap the Share button, then <b>Add to Home Screen</b>. It opens full-screen like a normal app and works offline.</p>`
        : `<p class="sub" style="margin:0">Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}
    </div>` : "";

  el.innerHTML = `
    ${head}
    <input class="input search" id="moreSearch" type="search" placeholder="Search: recipes, TeamSnap, allergies, invite…" autocomplete="off" aria-label="Search the app">
    <div id="moreNone" class="empty" hidden><div class="muted">Nothing matches. Try another word.</div></div>
    ${p ? tile("#/today", "today", "Today", "Your plan for today", "onlySearch") : ""}
    ${p ? tile("#/gameday", "ball", "Game Day", "Timeline and fuel for the next game", "onlySearch") : ""}
    ${p ? tile("#/recovery", "recover", "Recovery", "After the game", "onlySearch") : ""}
    ${p ? tile("#/checkin", "check", "Check-in", "How you feel today", "onlySearch") : ""}
    ${p && !p.shared ? tile("#/profile/edit", "user", "Edit profile", "Name, birthday, body, position, delete player", "onlySearch") : ""}
    ${install}
    <div class="sectionTitle">Plan</div>
    ${p ? tile("#/fun", "star", "Fun", p.features?.fuelBuddy ? "Your fuel buddy, stickers, stories and games" : p.features?.playlist ? "Playlist, season wrapped, quiz and cook night" : "Car quiz, cook night and grocery hunt") : ""}
    ${p ? tile("#/ask", "chat", "Ask", "Questions answered with your food rules") : ""}
    ${p ? tile("#/scan", "scan", "Scan food", "Is it safe, and is now a good time?") : ""}
    ${p ? tile("#/journal", "book", "Journal and stats", "30-second post-game reflection") : ""}
    ${p ? tile("#/progress", "flame", "Progress", "Streaks, badges and injury risk") : ""}
    ${p ? tile("#/health", "pulse", "Health", "Injuries, concussion steps, warm-ups, school and travel") : ""}
    ${p ? tile("#/meals", "fork", "Meals", "Week plan, recipes and eating out") : ""}
    ${p ? tile("#/program", "user", "My program", "Age-based fuel, sleep and recovery") : ""}
    ${p ? tile("#/profile/edit?food=1", "heart", "Food safety", "Allergies, diets and foods to avoid") : ""}
    ${p ? tile("#/connect", "calendar", "Team apps", "TeamSnap, SportsEngine, PlayMetrics, Google and more") : ""}
    ${p ? tile("#/schedule", "calendar", "Schedule", "Games, practices and repeats") : ""}
    ${p ? tile("#/trends", "chart", "Trends", "Sleep, readiness and training load") : ""}
    ${p ? tile("#/grocery", "cart", "Grocery list", "This week's shopping, allergy-safe") : ""}
    ${p ? tile("#/report", "doc", "Weekly report", "The week in one page") : ""}
    ${p ? tile("#/tournament", "bag", "Tournament planner", "Fuel between games, cooler, hotel") : ""}
    ${p ? tile("#/mind", "brain", "Mental skills", "Nerves, mistakes, the bench") : ""}
    ${p ? tile("#/season", "trophy", "Season review", "Save the season as a PDF") : ""}
    ${p ? tile("#/budget", "wallet", "Season budget", "Fees, travel and gear") : ""}
    ${p ? tile("#/emergency", "alert", "Emergency card", "Allergies, EpiPen, asthma, contacts") : ""}
    ${tile("#/safesport", "shield", "Safe sport", "Warning signs and how to report")}
    ${p && (p.features?.appleHealth || p.features?.whoop || p.features?.garmin) ? tile("#/devices", "watch", "Devices", "Whoop, Oura, Garmin, Apple Health") : ""}
    ${tile("#/invite", "chat", "Invite a friend", "Text, email or QR code to get the app")}
    ${tile("#/family", "family", "Family", "Link parent and player accounts")}
    ${p ? tile("#/experts", "heart", "Dietitians and camps", "Book a sports dietitian, find camps") : ""}
    ${tile("#/club", "team", "Club", isCoach() ? "Club staff, fields, medical roster" : "For club directors, coaches and trainers")}
    ${tile("#/team", "team", isCoach() ? "My teams" : "Team", isCoach() ? "Rosters, readiness and join codes" : "Join your coach's team")}
    ${isParent() ? tile("#/profile/new", "user", "Add an athlete", "Manage another child's plan") : ""}
    <div class="sectionTitle">Settings</div>
    ${tile("#/reminders", "bell", "Reminders", "Choose which nudges you get")}
    ${tile("#/account", "lock", "Account", esc(state.user?.email || ""))}
    <a class="tile" href="/privacy.html" style="text-decoration:none"><span class="ic">${icon("doc")}</span><span><div class="tt">Privacy Policy</div></span><span class="chev">›</span></a>
    <a class="tile" href="/terms.html" style="text-decoration:none"><span class="ic">${icon("doc")}</span><span><div class="tt">Terms of Use</div></span><span class="chev">›</span></a>
    <button class="btn ghost block" style="margin-top:8px" data-act="logout">Log out</button>
    <p class="disc">Nutrition guidance in this app is general education based on published sports-nutrition research. It is not medical advice. Athletes with medical conditions, eating concerns, or injuries should work with a doctor or registered dietitian.</p>`;
  wireSearch(el);
}

function wireSearch(el) {
  const input = el.querySelector("#moreSearch");
  if (!input) return;
  const run = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    el.querySelectorAll(".tile").forEach((t) => {
      const hay = `${t.textContent} ${t.dataset.k || ""}`.toLowerCase();
      const hit = words.length ? words.every((w) => hay.includes(w)) : !t.classList.contains("onlySearch");
      t.hidden = !hit; if (hit) shown++;
    });
    el.querySelectorAll(".sectionTitle, .disc, [data-act=logout], .card:not(.tile)").forEach((x) => { x.hidden = words.length > 0; });
    el.querySelector("#moreNone").hidden = !words.length || shown > 0;
  };
  input.addEventListener("input", run);
  run();
}

export const actions = {
  logout: () => logOut(),
  async install() {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null;
  },
};
