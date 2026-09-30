// Schedule: upcoming games and practices, add one-offs or weekly repeats, remove.

import { $, $$, esc, todayStr, to12, relDay, niceDate, toDateStr, msg, toast, addDays, icon } from "../ui.js";
import { api, errText } from "../api.js";
import { active, loadProfiles, render as rerender, syncReminders, isCoach } from "../app.js";
import { lookupZip } from "./profile.js";

const LABEL = { match: "Game", training: "Practice", recovery: "Recovery", travel: "Travel", tournament: "Tournament" };
const ADD_LABEL = { match: "Game", training: "Practice", recovery: "Recovery", travel: "Travel" };

export async function render(el, ctx) {
  const p = ctx.profile;
  if (!p) {
    el.innerHTML = `<div class="card empty"><div class="big">No athlete profile</div><p>${isCoach() ? "Coaches see team schedules through each player's plan. Create a profile if you want a plan of your own." : ""}</p>
      <button class="btn primary" data-act="nav" data-to="#/profile/new">Create a profile</button></div>`;
    return;
  }
  const today = todayStr();
  const events = (p.schedule?.events || []).filter((e) => e.startTime.slice(0, 10) >= today).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const groups = {};
  for (const e of events.slice(0, 60)) (groups[e.startTime.slice(0, 10)] ||= []).push(e);
  const pre = ctx.query.add || "match";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const feeds = p.schedule?.feeds || [];
  el.innerHTML = `
    <button class="tile" data-act="nav" data-to="#/connect"><span class="ic">${icon("calendar")}</span><span><div class="tt">${feeds.length ? `${feeds.length} team schedule${feeds.length === 1 ? "" : "s"} connected` : "Connect your team app"}</div>
      <div class="ts">${feeds.some((f) => f.lastError) ? "One needs attention. Tap to fix." : "TeamSnap, SportsEngine, PlayMetrics, GameChanger, LeagueApps, GotSport and more"}</div></span><span class="chev">›</span></button>

    <form class="card" data-submit="addEvent" novalidate>
      <h2>Add to schedule</h2>
      <div class="seg" style="margin:8px 0 4px" id="evType">${Object.entries(ADD_LABEL).map(([v, l]) => `<button type="button" class="${v === pre ? "on" : ""}" data-act="evType" data-v="${v}">${l}</button>`).join("")}</div>
      <div class="row2">
        <div><label class="f" for="evDate">Date</label><input class="input" id="evDate" type="date" value="${today}"></div>
        <div><label class="f" for="evTime">${pre === "match" ? "Kickoff" : "Start"}</label><input class="input" id="evTime" type="time" value="${pre === "training" ? p.routine?.usualPracticeTime || "17:00" : "10:00"}"></div>
      </div>
      <label class="f" for="evZip">Field ZIP <span class="dim">(optional, for away games)</span></label>
      <input class="input" id="evZip" inputmode="numeric" maxlength="5" placeholder="${esc(p.routine?.homeZip || "e.g. 08540")}">
      <div class="hint" id="evZipPlace">${p.routine?.homeZip ? `Leave blank to use your home ZIP (${esc(p.routine.homeZip)}).` : "Add a ZIP to get heat and cold plans for this game."}</div>
      <label class="f" for="evCond">Notes <span class="dim">(optional)</span></label>
      <input class="input" id="evCond" placeholder="Home, away, hot, turf…">
      <label class="check"><input type="checkbox" id="evRepeat"><span>Repeat every week</span></label>
      <div id="repeatBox" hidden>
        <label class="f">On</label>
        <div class="chips">${days.map((d, i) => `<label class="chip"><input type="checkbox" class="evDay" value="${i}">${d}</label>`).join("")}</div>
        <label class="f" for="evUntil">Until</label>
        <input class="input" id="evUntil" type="date" value="${addDays(today, 56)}">
      </div>
      <div class="actions"><button class="btn primary block" type="submit">Add</button></div>
      <div id="out"></div>
    </form>

    <div class="sectionTitle">Coming up</div>
    ${events.length ? Object.entries(groups).map(([d, list]) => `
      <div class="card tight">
        <div class="eyebrow">${esc(relDay(d))}${relDay(d) !== niceDate(d) ? " · " + esc(niceDate(d)) : ""}</div>
        <ul class="list">${list.map((e) => `<li>
          <span class="time">${e.startTime.length > 10 ? esc(to12(e.startTime.slice(11, 16))) : "All day"}</span>
          <div style="flex:1"><span class="kind ${e.type}">${esc(LABEL[e.type] || e.type)}</span>${e.title ? ` <b>${esc(e.title)}</b>` : ""}${e.conditions ? ` <span class="rowsub">${esc(e.conditions)}</span>` : ""}${e.zip ? ` <span class="rowsub">· ZIP ${esc(e.zip)}</span>` : ""}
            ${e.type === "match" ? `<div><button class="btn link sm" data-act="nav" data-to="#/gameday?date=${d}&kickoff=${e.startTime.slice(11, 16)}">Game-day plan ›</button></div>` : ""}</div>
          ${e.source && e.source !== "manual" ? `<span class="rowsub">from calendar</span>` : `<button class="btn ghost sm" data-act="delEvent" data-st="${esc(e.startTime)}" data-type="${e.type}" aria-label="Remove">Remove</button>`}
        </li>`).join("")}</ul>
      </div>`).join("") : `<div class="card empty"><p>Nothing coming up. Add your next game or practice above.</p></div>`}`;

  $("#evRepeat").addEventListener("change", (e) => {
    $("#repeatBox").hidden = !e.target.checked;
    if (e.target.checked && !$$(".evDay:checked").length) {
      const wd = new Date($("#evDate").value + "T12:00:00").getDay();
      const box = $$(".evDay").find((c) => Number(c.value) === wd); if (box) box.checked = true;
    }
  });
  el.dataset.type = pre;
  $("#evZip").addEventListener("input", (e) => lookupZip(e.target.value, "#evZipPlace"));
}

async function feedDone(r, text) {
  if (!r.ok) return toast(errText(r));
  toast(text);
  await loadProfiles(); await rerender(); syncReminders();
}

export const actions = {
  async feedAdd() {
    const url = $("#feedUrl").value.trim();
    if (!url) return toast("Paste the calendar link first.");
    const r = await api(`/api/profiles/${active().id}/calendars`, { method: "POST", body: { url, name: $("#feedName").value.trim() || undefined, defaultZip: $("#feedZip").value.trim() || undefined } });
    const f = r.ok ? r.data.schedule.feeds.at(-1) : null;
    await feedDone(r, f?.lastError ? `Added, but: ${f.lastError}` : `Added ${f?.eventCount ?? 0} games and practices`);
  },
  async feedSync() { await feedDone(await api(`/api/profiles/${active().id}/calendars/sync`, { method: "POST" }), "Calendars synced"); },
  async feedDel(btn) { await feedDone(await api(`/api/profiles/${active().id}/calendars/${btn.dataset.id}`, { method: "DELETE" }), "Calendar removed"); },
  evType(btn) {
    $("#view").dataset.type = btn.dataset.v;
    btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    if (btn.dataset.v === "training") $("#evTime").value = active()?.routine?.usualPracticeTime || "17:00";
  },
  async addEvent(form) {
    const p = active();
    const type = $("#view").dataset.type || "match";
    const date = $("#evDate").value, time = $("#evTime").value || "10:00";
    const conditions = $("#evCond").value.trim() || undefined;
    if (!date) return ($("#out").innerHTML = msg("err", "Pick a date."));
    const zip = $("#evZip").value.trim();
    if (zip && !/^\d{5}$/.test(zip)) return ($("#out").innerHTML = msg("err", "Enter a 5-digit ZIP, or leave it blank."));
    const mk = (d) => ({ type, startTime: `${d}T${time}`, importance: type === "match" ? "high" : "normal", ...(conditions ? { conditions } : {}), ...(zip ? { zip } : {}) });
    let events = [mk(date)];
    if ($("#evRepeat").checked) {
      const until = $("#evUntil").value;
      const wds = $$(".evDay:checked").map((c) => Number(c.value));
      if (!until || !wds.length) return ($("#out").innerHTML = msg("err", "Pick the days and an end date."));
      events = [];
      for (let cur = new Date(date + "T12:00:00"), end = new Date(until + "T12:00:00"), g = 0; cur <= end && g < 400; cur.setDate(cur.getDate() + 1), g++) {
        if (wds.includes(cur.getDay())) events.push(mk(toDateStr(cur)));
      }
      if (!events.length) return ($("#out").innerHTML = msg("err", "No matching days in that range."));
    }
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
    const r = await api(`/api/profiles/${p.id}/events`, { method: "POST", body: { events } });
    btn.disabled = false;
    if (!r.ok) return ($("#out").innerHTML = msg("err", errText(r)));
    toast(events.length > 1 ? `${events.length} added` : "Added");
    await loadProfiles(); syncReminders(); rerender();
  },
  async delEvent(btn) {
    const p = active();
    const series = btn.dataset.type === "training" && (p.schedule?.events || []).filter((e) => e.type === "training").length > 1
      && window.confirm("Remove every practice at this day and time from here on?\n\nOK = the whole series. Cancel = just this one.");
    const q = new URLSearchParams({ startTime: btn.dataset.st, type: btn.dataset.type, series: String(!!series) });
    const r = await api(`/api/profiles/${p.id}/events?${q}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    toast("Removed");
    await loadProfiles(); syncReminders(); rerender();
  },
};

