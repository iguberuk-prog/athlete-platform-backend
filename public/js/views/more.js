// More: profile card plus every secondary screen.

import { esc, icon, avatar } from "../ui.js";
import { isNative } from "../native.js";
import { state, isCoach, isParent, logOut } from "../app.js";
import { SPORTS } from "./profile.js";

let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const tile = (to, ic, a, b) =>
  `<button class="tile" data-act="nav" data-to="${to}"><span class="ic">${icon(ic)}</span><span><div class="tt">${a}</div><div class="ts">${b}</div></span><span class="chev">›</span></button>`;

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
