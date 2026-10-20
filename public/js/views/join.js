// Join a team from a club invite link: #/join?claim=TOKEN
//
// The club imports its roster and every player gets a one-time link. Opening it:
//   signed out  -> welcome page with the club, team and player name, then sign up or log in
//   signed in   -> pick which athlete this is (or set up the profile), then the link is redeemed
// The pending claim lives in localStorage so it survives sign-up and email confirmation.

import { $, esc, msg, toast, storeGet, storeSet, avatar, niceDate } from "../ui.js";
import { api, errText } from "../api.js";
import { state, isCoach, isParent, loadClub, go, render as rerender } from "../app.js";

const KEY = "pendingClaim";
export const pendingClaim = () => { const c = storeGet(KEY, null); return c && c.token ? c : null; };
export const clearClaim = () => { try { localStorage.removeItem(KEY); } catch {} };
export const cleanToken = (t) => String(t || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
const first = (name) => String(name || "").trim().split(/\s+/)[0] || "your athlete";

/** Set after a successful join so the confirmation screen can show it. */
export let lastJoined = null;
export const setLastJoined = (v) => { lastJoined = v; };

async function lookup(token) {
  const r = await api(`/api/claim/${encodeURIComponent(token)}`);
  return r.ok ? r.data : { missing: true, status: r.status };
}

function heroFor(c) {
  const brand = state.club?.brand?.primary ? `--club:${esc(state.club.brand.primary)};` : "";
  return `
    <section class="hero clubhero" style="${brand}">
      <div class="greet">${esc(c.clubName)}</div>
      <div class="headline">${esc(c.fullName)}</div>
      <div class="note">is invited to join <b>${esc(c.teamName)}</b>${c.jerseyNumber != null ? ` · #${esc(c.jerseyNumber)}` : ""}</div>
    </section>`;
}

const privacy = `<p class="disc">Coaches see readiness from check-ins, allergies for safe team meals, and the next game. Medical notes, contact details and full check-in history stay with the family.</p>`;

// ---------------------------------------------------------------------------
// Signed out: welcome page
// ---------------------------------------------------------------------------
export async function renderLanding(app, token) {
  token = cleanToken(token);
  app.innerHTML = `<div class="auth"><p class="muted">Opening your invite…</p></div>`;
  const c = await lookup(token);
  const brand = `<div class="brandbig"><div class="mark" aria-hidden="true">A</div><div><b>Athlete Performance</b><div class="muted small">Game-day fuel, recovery and check-ins</div></div></div>`;

  if (c.missing) {
    clearClaim();
    app.innerHTML = `<div class="auth">${brand}
      <h1>This invite link isn't valid</h1>
      <p class="sub">It may have been typed wrong, or the club cancelled it. Ask your club for a new link. You can still create an account and join with your coach's team code.</p>
      <button class="btn primary block" data-act="nav" data-to="#/signup">Create an account</button>
      <button class="btn ghost block" data-act="nav" data-to="#/login" style="margin-top:8px">Log in</button></div>`;
    return;
  }
  if (c.status === "joined") {
    clearClaim();
    app.innerHTML = `<div class="auth">${brand}
      <h1>${esc(c.fullName)} already joined ${esc(c.teamName)}</h1>
      <p class="sub">This invite has been used. If that was your family, just log in. If not, ask ${esc(c.clubName)} for a new link.</p>
      <button class="btn primary block" data-act="nav" data-to="#/login">Log in</button>
      <button class="btn ghost block" data-act="nav" data-to="#/signup" style="margin-top:8px">Create an account</button></div>`;
    return;
  }

  storeSet(KEY, { token, clubName: c.clubName, teamName: c.teamName, fullName: c.fullName, dateOfBirth: c.dateOfBirth, jerseyNumber: c.jerseyNumber, savedAt: Date.now() });
  app.innerHTML = `<div class="auth">
    ${brand}
    <div class="eyebrow">${esc(c.clubName)}</div>
    <h1 class="big">${esc(c.fullName)} is invited to <span class="hl">${esc(c.teamName)}</span></h1>
    <p class="sub">${esc(c.clubName)} uses Athlete Performance for game-day fuel, recovery, sleep and daily check-ins. Setup takes about a minute: the name and team are already filled in from the club roster.</p>
    <div class="card">
      <h3>Who is setting this up?</h3>
      <button class="btn primary block" data-act="nav" data-to="#/signup?role=parent">I'm a parent or guardian</button>
      <button class="btn ghost block" data-act="nav" data-to="#/signup?role=athlete" style="margin-top:8px">I'm the player (13 or older)</button>
      <button class="btn link block" data-act="nav" data-to="#/login" style="margin-top:4px">I already have an account</button>
    </div>
    <div class="card"><h3>What happens next</h3>
      <ol class="hsteps">
        <li>Create a free account.</li>
        <li>Answer the food-safety questions (allergies, diets).</li>
        <li>${esc(first(c.fullName))} lands on <b>${esc(c.teamName)}</b> and gets a plan for the next game.</li>
      </ol></div>
    ${privacy}
  </div>`;
}

// ---------------------------------------------------------------------------
// Signed in: match the invite to an athlete
// ---------------------------------------------------------------------------
export async function render(el, ctx) {
  if (ctx.query.done && lastJoined) return done(el, lastJoined);

  let claim = pendingClaim();
  const fromLink = cleanToken(ctx.query.claim);
  if (fromLink && (!claim || claim.token !== fromLink)) claim = { token: fromLink };
  if (!claim) {
    el.innerHTML = `<div class="card empty"><div class="big">No invite to finish</div><p>Open the link your club sent you, or join with your coach's team code under Team.</p>
      <button class="btn primary" data-act="nav" data-to="#/team">Go to Team</button></div>`;
    return;
  }

  const c = await lookup(claim.token);
  if (!ctx.seq()) return;
  if (c.missing) {
    clearClaim();
    el.innerHTML = `${msg("err", "This invite link isn't valid any more. Ask your club for a new one.")}<button class="btn ghost block" style="margin-top:12px" data-act="nav" data-to="#/team">Join with a team code instead</button>`;
    return;
  }
  if (c.status === "joined") {
    clearClaim();
    el.innerHTML = `${msg("info", `${c.fullName} already joined ${c.teamName}. If that was you, you're all set.`)}<button class="btn primary block" style="margin-top:12px" data-act="nav" data-to="#/today">Go to Today</button>`;
    return;
  }
  claim = { token: claim.token, clubName: c.clubName, teamName: c.teamName, fullName: c.fullName, dateOfBirth: c.dateOfBirth, jerseyNumber: c.jerseyNumber, savedAt: Date.now() };
  storeSet(KEY, claim);

  if (isCoach()) {
    el.innerHTML = `${heroFor(c)}
      <div class="card"><h3>This link is for a player's family</h3>
        <p class="sub">You're signed in as a coach (${esc(state.user?.email || "")}). Coaches don't have player profiles. To set up ${esc(first(c.fullName))}, log out and create a parent or player account. To join ${esc(c.clubName)} as staff, ask the director for a staff code instead.</p>
        <button class="btn ghost block" data-act="logout">Log out</button></div>`;
    return;
  }

  const profiles = state.profiles.filter((p) => !p.shared);
  const same = (p) => p.identity.fullName.trim().toLowerCase() === c.fullName.trim().toLowerCase();
  const match = profiles.find(same);
  el.innerHTML = `
    ${heroFor(c)}
    ${profiles.length ? `
      <div class="card"><h3>${match ? "Is this the right athlete?" : `Which athlete is ${esc(c.fullName)}?`}</h3>
        ${profiles.map((p) => `<div class="player">${avatar(p, "lg")}<div class="pm"><div class="pn">${esc(p.identity.fullName)}</div>
          <div class="pd">${p.identity.dateOfBirth ? `Born ${esc(niceDate(p.identity.dateOfBirth, { month: "short", day: "numeric", year: "numeric" }))}` : ""}${same(p) ? ` · <span style="color:var(--good)">name matches the roster</span>` : ""}</div></div>
          <button class="btn ${same(p) ? "primary" : "ghost"} sm" data-act="claimJoin" data-id="${p.id}" data-name="${esc(p.identity.fullName)}">Join team</button></div>`).join("")}
      </div>` : ""}
    <div class="card">
      <h3>${profiles.length ? `${esc(c.fullName)} isn't listed?` : `Set up ${esc(first(c.fullName))}'s profile`}</h3>
      <p class="sub">${profiles.length ? `Add ${esc(first(c.fullName))} as a new athlete. Name, birthday and jersey are filled in from the roster.` : `Name, birthday and jersey number come from the club roster. You add the food-safety answers, body and routine; it takes about a minute.`}</p>
      ${!profiles.length || isParent() ? `<button class="btn ${profiles.length ? "ghost" : "primary"} block" data-act="nav" data-to="#/profile/new?claim=1">${profiles.length ? `Add ${esc(first(c.fullName))} as a new athlete` : `Set up ${esc(first(c.fullName))}`}</button>` : `<p class="disc">Only a parent account can add more athletes. If this invite isn't yours, ask the club to send it to the right family.</p>`}
    </div>
    <button class="btn link block" data-act="claimLater">Not now</button>
    ${privacy}`;
}

function done(el, j) {
  const p = state.profiles.find((x) => x.id === j.profileId);
  el.innerHTML = `
    <section class="hero clubhero" style="${state.club?.brand?.primary ? `--club:${esc(state.club.brand.primary)};` : ""}">
      <div class="greet">${esc(j.clubName)}</div>
      <div class="headline">${esc(p ? first(p.identity.fullName) : "You're")} ${p ? "is" : ""} on ${esc(j.teamName)}</div>
      <div class="note">The coach now sees readiness and food safety for team meals. Everything else stays private.</div>
    </section>
    <div class="card"><h3>Good first steps</h3>
      <ul class="list">
        <li><span class="bullet"></span><div><b>Do today's check-in.</b> Sleep, soreness and energy take 30 seconds and set the day's plan.</div></li>
        <li><span class="bullet"></span><div><b>Add the next game.</b> Game Day builds the eating timeline backwards from kickoff.</div></li>
        <li><span class="bullet"></span><div><b>Put the app on the phone.</b> Under More, "Put it on your home screen".</div></li>
      </ul>
      <div class="actions"><button class="btn primary block" data-act="nav" data-to="#/checkin">Start the check-in</button></div>
      <button class="btn ghost block" style="margin-top:8px" data-act="nav" data-to="#/today">Go to Today</button></div>`;
}

export const actions = {
  async claimJoin(btn) {
    const claim = pendingClaim();
    if (!claim) return toast("Open the invite link again.");
    btn.disabled = true;
    const r = await api(`/api/claim/${encodeURIComponent(claim.token)}/redeem`, { method: "POST", body: { profileId: btn.dataset.id } });
    btn.disabled = false;
    if (!r.ok) return toast(errText(r), 5000);
    clearClaim();
    setLastJoined({ ...r.data, profileId: btn.dataset.id });
    await loadClub().catch(() => {});
    toast(`Joined ${r.data.teamName}`);
    go("#/join?done=1");
  },
  claimLater() {
    clearClaim();
    toast("You can open the invite link again any time.");
    go(state.profiles.length ? "#/today" : "#/profile/new");
  },
};
