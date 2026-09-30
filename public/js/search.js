// App-wide search: the magnifier in the top bar and the search box on Today.
// Finds any screen by its name or everyday words ("recipes", "teamsnap", "epipen").

import { $, esc, icon } from "./ui.js";

// [route, icon, title, subtitle, extra words, needs a player?]
export const SCREENS = [
  ["#/today", "today", "Today", "Your plan for today", "home plan morning", true],
  ["#/gameday", "ball", "Game Day", "Timeline and fuel for the next game", "game kickoff match timeline", true],
  ["#/recovery", "recover", "Recovery", "After the game", "rest after game", true],
  ["#/checkin", "check", "Check-in", "How you feel today", "check in feel sleep soreness mood", true],
  ["#/invite", "invite", "Invite a friend", "Text, email or QR code to get the app", "share friend refer referral text sms email qr download teammate", false],
  ["#/connect", "calendar", "Team apps", "TeamSnap, SportsEngine, PlayMetrics, Google and more", "teamsnap sportsengine playmetrics gamechanger leagueapps gotsport calendar sync import link google spond band", true],
  ["#/schedule", "calendar", "Schedule", "Games, practices and repeats", "games practice calendar add event match training", true],
  ["#/meals", "fork", "Meals", "Recipes, week plan and eating out", "recipes cook cooking food dinner lunch breakfast snack eat restaurant eating out", true],
  ["#/scan", "scan", "Scan food", "Is it safe, and is now a good time?", "barcode product label camera", true],
  ["#/fun", "star", "Fun", "Buddy, stickers, quiz, cook night, playlist", "quiz sticker buddy playlist spotify music story wrapped game kids", true],
  ["#/ask", "chat", "Ask", "Questions answered with your food rules", "question chat help", true],
  ["#/health", "pulse", "Health", "Injuries, concussion steps, warm-ups", "injury concussion asthma warmup period cycle sick soreness growth heat", true],
  ["#/emergency", "alert", "Emergency card", "Allergies, EpiPen, asthma, contacts", "epipen allergy contact 911 medical", true],
  ["#/profile/edit?food=1", "heart", "Food safety", "Allergies, diets and foods to avoid", "allergy allergies diet vegetarian vegan gluten dairy nuts kosher halal", true],
  ["#/profile/edit", "user", "Edit profile", "Name, birthday, body, position, delete player", "edit name birthday weight height position level delete remove player", true],
  ["#/grocery", "cart", "Grocery list", "This week's shopping, allergy-safe", "shopping list store", true],
  ["#/progress", "flame", "Progress", "Streaks, badges and injury risk", "streak badge points risk freeze", true],
  ["#/journal", "book", "Journal and stats", "Post-game reflection", "stats goals game log reflection", true],
  ["#/program", "user", "My program", "Age-based fuel, sleep and recovery", "age sleep protein hydration water", true],
  ["#/trends", "chart", "Trends", "Sleep, readiness and training load", "chart graph sleep readiness load", true],
  ["#/tournament", "bag", "Tournament planner", "Fuel between games, cooler, hotel", "cooler hotel between games", true],
  ["#/mind", "brain", "Mental skills", "Nerves, mistakes, the bench", "nerves confidence mental breathing", true],
  ["#/season", "trophy", "Season review", "Save the season as a PDF", "pdf review print", true],
  ["#/budget", "wallet", "Season budget", "Fees, travel and gear", "money cost fees expense", true],
  ["#/family", "family", "Family", "Link parent and player accounts", "parent link share account kid", false],
  ["#/experts", "heart", "Dietitians and camps", "Book a sports dietitian, find camps", "dietitian nutritionist camp", true],
  ["#/team", "team", "Team", "Join your coach's team, or your teams", "join code coach roster", false],
  ["#/club", "team", "Club", "For club directors, coaches and trainers", "director coach trainer", false],
  ["#/profile/new", "user", "Add an athlete", "Add another player", "add child kid player new", false],
  ["#/reminders", "bell", "Reminders", "Choose which nudges you get", "notifications alerts nudges", false],
  ["#/account", "lock", "Account", "Password, sign out, delete account", "password delete email logout sign out", false],
];

export function searchHits(q, hasPlayer) {
  const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SCREENS.filter((s) => (hasPlayer || !s[5]) && words.every((w) => `${s[2]} ${s[3]} ${s[4]}`.toLowerCase().includes(w)));
}

const row = (s) => `<button class="tile" data-act="searchGo" data-to="${s[0]}"><span class="ic">${icon(s[1])}</span><span><div class="tt">${esc(s[2])}</div><div class="ts">${esc(s[3])}</div></span><span class="chev">›</span></button>`;

/** Full-screen search sheet. */
export function openSearch(hasPlayer) {
  closeSearch();
  const box = document.createElement("div");
  box.id = "searchSheet";
  box.className = "sheet";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Search");
  box.innerHTML = `<div class="sheetbar"><input class="input search" id="searchInput" type="search" placeholder="Search: recipes, TeamSnap, allergies, invite…" autocomplete="off" aria-label="Search the app"><button class="btn link" data-act="searchClose">Cancel</button></div>
    <div id="searchOut" class="sheetbody"></div>`;
  document.body.appendChild(box);
  const input = $("#searchInput");
  const draw = () => {
    const hits = searchHits(input.value, hasPlayer);
    $("#searchOut").innerHTML = input.value.trim()
      ? hits.map(row).join("") || `<div class="empty"><div class="muted">Nothing matches. Try another word.</div></div>`
      : `<div class="sectionTitle">Popular</div>${SCREENS.filter((s) => ["#/invite", "#/connect", "#/meals", "#/scan", "#/fun"].includes(s[0]) && (hasPlayer || !s[5])).map(row).join("")}`;
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); if (e.key === "Enter") { const first = $("#searchOut .tile"); if (first) first.click(); } });
  draw();
  setTimeout(() => input.focus(), 30);
}

export function closeSearch() { document.getElementById("searchSheet")?.remove(); }
