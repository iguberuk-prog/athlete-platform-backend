// Team hub: announcements, challenges, homework, sign-ups, team calendar.
// Rendered inside the coach roster, and as its own screen for families (#/teamhub/:teamId).

import { $, esc, todayStr, addDays, niceDate, to12, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active, state, render as rerender } from "../app.js";

const CH = { checkin: "Check-in streak", hydration: "Hydration week", sleep: "Sleep challenge", warmup: "Warm-up challenge" };
const KIND = { snack: "Snacks", carpool: "Carpool", volunteer: "Volunteer" };
let current = null;

export async function renderHub(el, teamId) {
  const r = await api(`/api/teams/${teamId}/hub?date=${todayStr()}`);
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const h = (current = r.data);
  const coach = h.role === "coach";
  el.innerHTML = `
    <div class="card"><h3>Announcements</h3>
      ${coach ? `<form data-submit="hubAnnounce" class="row2"><input class="input" id="annText" maxlength="500" placeholder="Message to the whole team and parents"><button class="btn primary">Post</button></form>` : ""}
      ${h.announcements.length ? `<ul class="list">${h.announcements.map((a) => `<li><div style="flex:1"><div>${esc(a.text)}</div><div class="rowsub">${esc(a.by)} · ${esc(new Date(a.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div></div>
        ${coach ? `<button class="btn ghost sm" data-act="hubAnnDel" data-id="${a.id}" aria-label="Delete">✕</button>` : ""}</li>`).join("")}</ul>` : `<p class="sub">Nothing yet.</p>`}
      ${coach ? `<p class="disc">Everything here goes to the whole team. There's no private coach-to-player messaging in the app.</p>` : ""}
    </div>

    <div class="card"><h3>Team challenges</h3>
      ${h.challenges.map((c) => `<div class="chal">
        <div class="rowtitle">${esc(c.title)} ${c.live ? `<span class="pill ready"><span class="dot"></span>Live</span>` : ""}</div>
        <div class="rowsub">${esc(niceDate(c.start))} to ${esc(niceDate(c.end))} · team score ${c.board.teamPct}%</div>
        <ol class="board">${c.board.rows.slice(0, 10).map((r) => `<li><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join("")}</ol>
        ${c.winners ? `<div class="msg ok">Winner${c.winners.length > 1 ? "s" : ""}: ${esc(c.winners.join(", ") || "none")}</div>` : coach && c.end <= todayStr() ? `<button class="btn primary sm" data-act="hubWinners" data-id="${c.id}">Announce winners</button>` : ""}
      </div>`).join("") || `<p class="sub">No challenge right now.</p>`}
      ${coach ? `<form data-submit="hubChallenge" class="grid2">
        <label>Type<select class="input" id="chType">${Object.entries(CH).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
        <label>Days<select class="input" id="chDays"><option value="7">1 week</option><option value="14">2 weeks</option><option value="28">4 weeks</option></select></label>
        <button class="btn ghost" style="grid-column:1/-1">Start a challenge today</button></form>` : ""}
    </div>

    <div class="card"><h3>Skills homework</h3>
      ${h.homework.map((w) => `<div class="hw"><div class="rowtitle">${esc(w.title)}${w.minutes ? ` · ${w.minutes} min` : ""}</div>
        ${w.description ? `<div class="small">${esc(w.description)}</div>` : ""}
        <div class="rowsub">${w.due ? `Due ${esc(niceDate(w.due))} · ` : ""}${w.doneCount} done</div>
        ${w.videoUrl ? `<a class="btn link sm" href="${esc(w.videoUrl)}" target="_blank" rel="noopener">Watch the drill ›</a>` : ""}
        ${!coach ? (w.doneByMine.length ? `<span class="pill ready"><span class="dot"></span>Done</span>` : `<button class="btn primary sm" data-act="hubDone" data-id="${w.id}">I did it</button>`) : ""}
        ${coach && w.doneBy?.length ? `<details class="table"><summary>Who did it</summary><ul class="list">${w.doneBy.map((d) => `<li><div>${esc(d.name)} · ${esc(niceDate(d.date))}${d.note ? ` · ${esc(d.note)}` : ""}${d.videoUrl ? ` · <a href="${esc(d.videoUrl)}" target="_blank" rel="noopener">video</a>` : ""}</div></li>`).join("")}</ul></details>` : ""}
      </div>`).join("") || `<p class="sub">No homework right now.</p>`}
      ${coach ? `<form data-submit="hubHomework" novalidate><input class="input" id="hwTitle" placeholder="Drill name, e.g. 100 wall passes each foot" maxlength="80">
        <textarea class="input" id="hwDesc" placeholder="How to do it (optional)" style="margin-top:8px"></textarea>
        <div class="row2" style="margin-top:8px"><input class="input" id="hwVideo" placeholder="Video link https://… (optional)"><input class="input" id="hwDue" type="date" value="${addDays(todayStr(), 7)}"></div>
        <div class="actions"><button class="btn ghost">Assign</button></div></form>` : ""}
    </div>

    <div class="card"><h3>Sign-ups</h3>
      ${h.signups.map((s) => `<div class="hw"><div class="rowtitle">${esc(KIND[s.kind])}: ${esc(s.title)}</div>
        <div class="rowsub">${esc(niceDate(s.date))}${s.time ? ` · ${esc(to12(s.time))}` : ""} · ${s.takenBy.length}/${s.slots} taken</div>
        ${s.takenBy.length ? `<div class="small">${s.takenBy.map((t) => esc(t.name) + (t.note ? ` (${esc(t.note)})` : "")).join(", ")}</div>` : ""}
        ${s.mine ? `<button class="btn ghost sm" data-act="hubSlot" data-id="${s.id}" data-release="1">Cancel my spot</button>` : s.takenBy.length < s.slots ? `<button class="btn primary sm" data-act="hubSlot" data-id="${s.id}">Take a spot</button>` : ""}
      </div>`).join("") || `<p class="sub">No open sign-ups.</p>`}
      ${h.snackIdeas.halftime.length ? `<p class="small"><b>Snacks safe for everyone on this team:</b> ${esc([...h.snackIdeas.halftime, ...h.snackIdeas.after].slice(0, 8).join(", "))}.</p>` : ""}
      <form data-submit="hubSignup" class="grid2">
        <label>Type<select class="input" id="suKind"><option value="snack">Snacks</option><option value="carpool">Carpool</option><option value="volunteer">Volunteer</option></select></label>
        <label>Spots<input class="input" id="suSlots" type="number" min="1" max="20" value="1"></label>
        <label>Date<input class="input" id="suDate" type="date" value="${addDays(todayStr(), 3)}"></label>
        <label>Time<input class="input" id="suTime" type="time"></label>
        <input class="input" id="suTitle" placeholder="e.g. Saturday home game" style="grid-column:1/-1">
        <button class="btn ghost" style="grid-column:1/-1">Add sign-up</button></form>
    </div>

    ${coach ? `<div class="card"><h3>Team calendar</h3>
      <p class="sub">Add your TeamSnap, SportsEngine or PlayMetrics calendar once. Every player's schedule updates on its own.</p>
      ${h.feed?.url ? `<p class="small">${h.feed.lastError ? `Problem: ${esc(h.feed.lastError)}` : `${h.feed.count ?? 0} events synced`}</p>` : ""}
      <form data-submit="hubFeed" class="row2"><input class="input" id="hubFeedUrl" placeholder="webcal://… or https://….ics" value="${esc(h.feed?.url || "")}"><button class="btn ghost">${h.feed?.url ? "Update" : "Connect"}</button></form></div>` : ""}`;
}

export async function render(el, ctx) {
  const teamId = ctx.sub;
  if (!teamId) { el.innerHTML = msg("err", "Team not found."); return; }
  el.innerHTML = `<div id="hubBox"></div>`;
  await renderHub($("#hubBox"), teamId);
}

const again = () => rerender();
const tid = () => current?.team.id;

export const actions = {
  async hubAnnounce() {
    const r = await api(`/api/teams/${tid()}/announce`, { method: "POST", body: { text: $("#annText").value } });
    if (!r.ok) return toast(errText(r)); again();
  },
  async hubAnnDel(btn) { await api(`/api/teams/${tid()}/announce/${btn.dataset.id}`, { method: "DELETE" }); again(); },
  async hubChallenge() {
    const days = Number($("#chDays").value);
    const r = await api(`/api/teams/${tid()}/challenges`, { method: "POST", body: { type: $("#chType").value, start: todayStr(), end: addDays(todayStr(), days - 1) } });
    if (!r.ok) return toast(errText(r)); toast("Challenge started and announced"); again();
  },
  async hubWinners(btn) {
    const r = await api(`/api/teams/${tid()}/challenges/${btn.dataset.id}/winners`, { method: "POST", body: {} });
    if (!r.ok) return toast(errText(r)); again();
  },
  async hubHomework() {
    const r = await api(`/api/teams/${tid()}/homework`, { method: "POST", body: { title: $("#hwTitle").value, description: $("#hwDesc").value || undefined, videoUrl: $("#hwVideo").value || undefined, due: $("#hwDue").value || undefined } });
    if (!r.ok) return toast(errText(r)); again();
  },
  async hubDone(btn) {
    const p = active();
    const r = await api(`/api/teams/${tid()}/homework/${btn.dataset.id}/done`, { method: "POST", body: { profileId: p.id, date: todayStr() } });
    if (!r.ok) return toast(errText(r)); toast("Nice work!"); again();
  },
  async hubSignup() {
    const r = await api(`/api/teams/${tid()}/signups`, { method: "POST", body: { kind: $("#suKind").value, slots: Number($("#suSlots").value), date: $("#suDate").value, time: $("#suTime").value || undefined, title: $("#suTitle").value || undefined } });
    if (!r.ok) return toast(errText(r)); again();
  },
  async hubSlot(btn) {
    const release = btn.dataset.release === "1";
    const name = release ? "" : prompt("Your name (shown to the team)", state.user?.email?.split("@")[0] || "");
    if (!release && !name) return;
    const r = await api(`/api/teams/${tid()}/signups/${btn.dataset.id}`, { method: "POST", body: { name, release } });
    if (!r.ok) return toast(errText(r)); again();
  },
  async hubFeed() {
    const r = await api(`/api/teams/${tid()}/feed`, { method: "PUT", body: { url: $("#hubFeedUrl").value.trim() || null } });
    if (!r.ok) return toast(errText(r));
    toast(r.data.error ? `Saved, but: ${r.data.error}` : `${r.data.count} events sent to every player`); again();
  },
};
