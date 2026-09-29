// Team: coaches create teams and see rosters; players join with a code.

import { $, esc, todayStr, relDay, to12, msg, toast, avatar, daysBetween } from "../ui.js";
import { api, errText } from "../api.js";
import { active, isCoach, go, render as rerender } from "../app.js";
import { statusPill } from "./today.js";

export async function render(el, ctx) {
  if (isCoach()) return ctx.sub ? roster(el, ctx) : coachHome(el, ctx);
  return playerTeams(el, ctx);
}

// ---------------- coach ----------------
async function coachHome(el, ctx) {
  const r = await api("/api/teams");
  if (!ctx.seq()) return;
  const teams = r.ok ? r.data.teams : [];
  el.innerHTML = `
    ${teams.map((t) => `<button class="tile" data-act="nav" data-to="#/team/${t.id}">
      <span class="ic">${t.memberCount}</span><span><div class="tt">${esc(t.name)}</div><div class="ts">${t.memberCount} player${t.memberCount === 1 ? "" : "s"} · code ${esc(t.code)}</div></span><span class="chev">›</span></button>`).join("")}
    ${teams.length ? "" : `<div class="card empty"><div class="big">Create your first team</div><p>You get a join code. Players enter it in their app and show up on your roster with readiness and food-safety info.</p></div>`}
    <form class="card" data-submit="createTeam" novalidate>
      <h2>New team</h2>
      <label class="f" for="teamName">Team name</label>
      <input class="input" id="teamName" placeholder="e.g. U17 Boys Premier" maxlength="80">
      <div class="actions"><button class="btn primary block" type="submit">Create team</button></div>
      <div id="out"></div>
    </form>
    <div class="card"><h3>What coaches see</h3><p class="sub" style="margin:0">Name, photo, position, readiness from check-ins, next game, allergies and diet, and whether an injury is on file (no details). Players' contact details, medical notes and full history stay private.</p></div>`;
}

async function roster(el, ctx) {
  const r = await api(`/api/teams/${ctx.sub}/roster?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  const { team, players } = r.data;
  const today = todayStr();
  const rank = (p) => (p.readiness ? { low: 0, moderate: 1, ready: 2 }[p.readiness.status] : -1);
  players.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const checkedToday = players.filter((p) => p.lastCheckinDate === today).length;
  const low = players.filter((p) => p.readiness?.status === "low" && p.lastCheckinDate === today).length;
  const allergy = players.filter((p) => p.allergies.length).length;

  el.innerHTML = `
    <section class="hero">
      <div class="greet">Team</div><div class="headline">${esc(team.name)}</div>
      <div class="note">${checkedToday} of ${players.length} checked in today${low ? ` · <b style="color:#ffb0b0">${low} flagged low</b>` : ""}${allergy ? ` · ${allergy} with allergies` : ""}</div>
    </section>
    <div class="card">
      <h3>Join code</h3>
      <div class="codebox" aria-label="Join code">${esc(team.code)}</div>
      <div class="actions"><button class="btn primary" data-act="shareCode" data-code="${esc(team.code)}" data-name="${esc(team.name)}">Share with players</button></div>
    </div>
    <div class="card">
      <h3>Roster</h3>
      ${players.length ? players.map((p) => {
        const stale = !p.lastCheckinDate ? "Never checked in" : p.lastCheckinDate === today ? "" : `Last check-in ${relDay(p.lastCheckinDate).toLowerCase()}`;
        const bits = [];
        if (p.lastCheckinDate && daysBetween(p.lastCheckinDate, today) <= 1) {
          if (p.sleepHours !== null) bits.push(`${p.sleepHours} h sleep`);
          if (p.soreness !== null) bits.push(`soreness ${p.soreness}/10`);
        }
        if (p.nextMatch) bits.push(`next game ${relDay(p.nextMatch.date).toLowerCase()} ${to12(p.nextMatch.time)}`);
        return `<div class="player">${avatar({ identity: { fullName: p.name, avatarUrl: p.avatarUrl } }, "lg")}
          <div class="pm">
            <div class="pn">${esc(p.name)}${p.jerseyNumber !== undefined && p.jerseyNumber !== null ? ` <span class="dim">#${p.jerseyNumber}</span>` : ""}</div>
            <div class="pd">${esc(p.positions.join(", ").replace(/_/g, " "))}</div>
            <div style="margin-top:6px">${p.lastCheckinDate === today ? statusPill(p.readiness) : `<span class="pill neutral"><span class="dot"></span>${esc(stale)}</span>`}
              ${p.injuryFlag ? `<span class="pill low"><span class="dot"></span>Injury on file</span>` : ""}</div>
            ${bits.length ? `<div class="pd">${esc(bits.join(" · "))}</div>` : ""}
            ${p.allergies.length || p.diets.length ? `<div class="pd" style="color:#ffd98a">Avoid: ${esc([...p.allergies, ...p.diets].join(", ").replace(/_/g, " "))}</div>` : ""}
          </div>
          <button class="btn ghost sm" data-act="removePlayer" data-team="${team.id}" data-id="${p.profileId}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">Remove</button>
        </div>`;
      }).join("") : `<p class="muted">No players yet. Share the join code above.</p>`}
    </div>
    <button class="btn danger block" data-act="deleteTeam" data-team="${team.id}" data-name="${esc(team.name)}">Delete team</button>`;
}

// ---------------- player / parent ----------------
async function playerTeams(el, ctx) {
  const p = ctx.profile;
  if (!p) { el.innerHTML = `<div class="card empty"><p>Create a profile first.</p></div>`; return; }
  const r = await api(`/api/profiles/${p.id}/teams`);
  if (!ctx.seq()) return;
  const teams = r.ok ? r.data.teams : [];
  el.innerHTML = `
    ${teams.length ? `<div class="card"><h3>${esc(p.identity.fullName.split(" ")[0])}'s teams</h3><ul class="list">${teams.map((t) => `
      <li><div style="flex:1"><div class="rowtitle">${esc(t.name)}</div><div class="rowsub">Joined ${esc(relDay(t.joinedAt.slice(0, 10)).toLowerCase())}</div></div>
      <button class="btn ghost sm" data-act="leaveTeam" data-team="${t.id}" data-name="${esc(t.name)}">Leave</button></li>`).join("")}</ul></div>` : ""}
    <form class="card" data-submit="joinTeam" novalidate>
      <h2>Join a team</h2>
      <p class="sub">Enter the 6-character code from your coach.</p>
      <input class="input" id="code" autocapitalize="characters" autocomplete="off" maxlength="8" placeholder="e.g. K7F2QM" style="font-family:ui-monospace,Menlo,monospace;font-size:22px;letter-spacing:3px;text-transform:uppercase">
      <div class="actions"><button class="btn primary block" type="submit">Join</button></div>
      <div id="out"></div>
    </form>
    <div class="card"><h3>What your coach will see</h3><p class="sub" style="margin:0">Your name, photo, position, readiness from check-ins, next game, allergies and diet (so team meals are safe), and whether an injury is on file, without any details. Your contact details, medical notes and full check-in history stay private. You can leave any time.</p></div>`;
}

export const actions = {
  async createTeam(form) {
    const name = $("#teamName").value.trim();
    if (!name) return ($("#out").innerHTML = msg("err", "Give the team a name."));
    const r = await api("/api/teams", { method: "POST", body: { name } });
    if (!r.ok) return ($("#out").innerHTML = msg("err", errText(r)));
    go(`#/team/${r.data.id}`);
  },
  async shareCode(btn) {
    const text = `Join ${btn.dataset.name} on Athlete Performance. Open ${location.origin}, go to More > Team, and enter code ${btn.dataset.code}.`;
    if (navigator.share) { try { await navigator.share({ title: "Team code", text }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); toast("Invite copied"); } catch { toast(`Code: ${btn.dataset.code}`); }
  },
  async removePlayer(btn) {
    if (!window.confirm(`Remove ${btn.dataset.name} from the team?`)) return;
    const r = await api(`/api/teams/${btn.dataset.team}/members/${btn.dataset.id}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    rerender();
  },
  async deleteTeam(btn) {
    if (!window.confirm(`Delete ${btn.dataset.name}? Players stay in the app but leave this roster.`)) return;
    const r = await api(`/api/teams/${btn.dataset.team}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    go("#/team");
  },
  async joinTeam() {
    const code = $("#code").value.trim();
    if (code.replace(/\W/g, "").length < 6) return ($("#out").innerHTML = msg("err", "Enter the full 6-character code."));
    const r = await api(`/api/profiles/${active().id}/teams`, { method: "POST", body: { code } });
    if (!r.ok) return ($("#out").innerHTML = msg("err", errText(r)));
    toast(`Joined ${r.data.team.name}`);
    rerender();
  },
  async leaveTeam(btn) {
    if (!window.confirm(`Leave ${btn.dataset.name}? Your coach will no longer see your readiness.`)) return;
    const r = await api(`/api/profiles/${active().id}/teams/${btn.dataset.team}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    rerender();
  },
};
