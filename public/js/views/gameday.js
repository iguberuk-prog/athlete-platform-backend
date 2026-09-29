// Game Day: pick a game, see the hour-by-hour plan (list or calendar), add to calendar.

import { esc, todayStr, to12, relDay, niceDate, untilText, minutesOf, storeGet, storeSet, toDateStr } from "../ui.js";
import { api, errText } from "../api.js";

let current = null;

function upcomingMatches(p) {
  const today = todayStr();
  return (p.schedule?.events || [])
    .filter((e) => e.type === "match" && e.startTime.slice(0, 10) >= today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function render(el, ctx) {
  const p = ctx.profile;
  const matches = upcomingMatches(p);
  if (!matches.length) {
    el.innerHTML = `<div class="card empty"><div class="big">No games on the schedule</div>
      <p>Add your next game and get an hour-by-hour plan: what to eat, when, and how to recover.</p>
      <button class="btn primary" data-act="nav" data-to="#/schedule?add=match">Add a game</button></div>`;
    return;
  }
  const date = ctx.query.date && matches.some((m) => m.startTime.startsWith(ctx.query.date)) ? ctx.query.date : matches[0].startTime.slice(0, 10);
  const sameDay = matches.filter((m) => m.startTime.startsWith(date));
  const kickoff = ctx.query.kickoff || sameDay[0].startTime.slice(11, 16) || "19:00";

  const picker = matches.slice(0, 8).map((m) => {
    const d = m.startTime.slice(0, 10), k = m.startTime.slice(11, 16);
    const on = d === date && k === kickoff;
    return `<button class="pchip ${on ? "on" : ""}" data-act="nav" data-to="#/gameday?date=${d}&kickoff=${k}">${esc(relDay(d))} · ${esc(to12(k))}</button>`;
  }).join("");

  el.innerHTML = `<div class="switcher">${picker}</div><div id="gd">${"<div class='empty muted'>Building your plan…</div>"}</div>`;
  const r = await api(`/api/profiles/${p.id}/timeline?date=${date}&kickoff=${kickoff}&wake=${p.routine?.wakeTime || ""}&bed=${p.routine?.bedTime || ""}`);
  if (!ctx.seq()) return;
  const box = el.querySelector("#gd");
  if (!r.ok) { box.innerHTML = `<div class="msg err">${esc(errText(r))}</div>`; return; }
  current = r.data;
  box.innerHTML = renderTimeline(current, date === todayStr());
}

function renderTimeline(t, isToday) {
  const warns = (t.safety.warnings || []).map((w) => `<div class="warnbox">${esc(w)}</div>`).join("");
  const avoid = [...t.safety.avoidAllergens.map((a) => a.replace(/_/g, " ")), ...t.safety.diets.map((d) => d.replace(/_/g, " "))];
  const view = storeGet("gdView", "list");
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const db = t.dayBefore;
  const dayBefore = db && db.date >= todayStr() ? `
    <div class="daybefore"><div class="dbh">${esc(db.title)} · ${esc(niceDate(db.date))}</div>
      ${db.items.map((it) => `<div class="dbr"><div class="dbw">${esc(it.when)}</div><div class="rowtitle">${esc(it.title)}</div><div class="rowsub">${esc(it.detail)}</div>${foods(it.foods)}</div>`).join("")}
    </div>` : "";

  const rows = t.entries.map((e, i) => {
    const m = minutesOf(e.time), next = t.entries[i + 1] ? minutesOf(t.entries[i + 1].time) : 1440;
    const cls = isToday ? (m <= nowMin && nowMin < next ? "now" : m < nowMin ? "past" : "") : "";
    return `<div class="tlrow ${cls}">
      <button type="button" class="tlhead" aria-expanded="${cls === "now"}" data-act="toggleRow">
        <span class="time">${esc(to12(e.time))}</span><span class="rowtitle">${esc(e.phase)}</span><span class="chev">▾</span></button>
      <div class="tlbody" ${cls === "now" ? "" : "hidden"}><div class="rowtitle" style="font-size:13.5px">${esc(e.title)}</div><div class="rowsub">${esc(e.detail)}</div>${foods(e.foods)}</div>
    </div>`;
  }).join("");

  const kickDT = `${t.date}T${t.kickoff}`;
  return `
    <section class="hero">
      <div class="greet">${esc(niceDate(t.date, { weekday: "long", month: "long", day: "numeric" }))}</div>
      <div class="headline">Kickoff ${esc(to12(t.kickoff))}</div>
      <div class="note">${t.playsTomorrow ? "You play again tomorrow. Tonight's recovery matters." : `Plan scaled to ${Math.round(t.bodyMassKg / 0.453592)} lb.`}</div>
      <div class="countdown">${new Date(kickDT) > new Date() ? `Kickoff in <b>${esc(untilText(kickDT))}</b>` : "Game started or finished"}</div>
    </section>
    ${warns}
    ${avoid.length ? `<div class="card tight"><span class="small muted">Always avoiding: </span><b class="small">${esc(avoid.join(", "))}</b></div>` : ""}
    ${dayBefore}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <h3 style="margin:0">Game day</h3>
        <div class="seg" role="tablist"><button class="${view === "list" ? "on" : ""}" data-act="gdView" data-v="list">List</button><button class="${view === "cal" ? "on" : ""}" data-act="gdView" data-v="cal">Calendar</button></div>
      </div>
      <div id="gdList" ${view === "list" ? "" : "hidden"}><div class="tl">${rows}</div></div>
      <div id="gdCal" ${view === "cal" ? "" : "hidden"}>${buildCalendar(t, isToday)}</div>
    </div>
    <div class="card">
      <h3>${esc(t.nightRoutine.title)}</h3>
      <ul class="list">${t.nightRoutine.items.map((i) => `<li><span class="bullet"></span><div>${esc(i)}</div></li>`).join("")}</ul>
    </div>
    <div class="card">
      <h3>Add to your calendar</h3>
      <div class="actions" style="margin-top:0">
        <button class="btn primary" data-act="downloadIcs">Apple / Outlook (.ics)</button>
        <button class="btn ghost" data-act="gcal">Google Calendar</button>
      </div>
      ${t.playsTomorrow ? `<button class="btn link" data-act="nav" data-to="#/recovery">See the multi-day recovery plan ›</button>` : ""}
    </div>
    <p class="disc">${esc(t.disclaimer)}</p>`;
}

const foods = (f) => (f && f.length ? `<div class="foods">Try: ${f.map(esc).join(", ")}</div>` : "");

// ---- calendar grid ----
const PX = 1.1;
const COLOR = { "Wake-up": "wake", "Pre-game meal": "meal", "Pre-game top-up": "meal", Kickoff: "game", "Half-time": "game", "Full time": "game", "Immediate recovery": "recover", "Evening meal": "meal", "Night routine": "night", Bed: "night" };
const DUR = { "Pre-game meal": 45, "Evening meal": 45, Kickoff: 30, "Half-time": 20, "Full time": 20, "Immediate recovery": 25, "Wake-up": 30, "Pre-game top-up": 20, "Night routine": 30, Bed: 15 };
const hourLabel = (h) => `${h % 12 || 12} ${h >= 12 && h < 24 ? "PM" : "AM"}`;

function buildCalendar(t, isToday) {
  const mins = t.entries.map((e) => minutesOf(e.time));
  const lo = Math.floor(Math.min(minutesOf(t.wakeTime), ...mins) / 60) * 60;
  const hi = Math.ceil(Math.max(minutesOf(t.bedTime), ...mins) / 60) * 60;
  const H = Math.max(120, (hi - lo) * PX);
  let lines = "", labels = "";
  for (let m = lo; m <= hi; m += 60) {
    const y = (m - lo) * PX;
    lines += `<div class="calline" style="top:${y}px"></div>`;
    labels += `<div class="callabel" style="top:${y - 7}px">${hourLabel(m / 60)}</div>`;
  }
  const k = t.entries.find((e) => e.phase === "Kickoff"), ft = t.entries.find((e) => e.phase === "Full time");
  const band = k && ft ? `<div class="calband" style="top:${(minutesOf(k.time) - lo) * PX}px;height:${Math.max(24, (minutesOf(ft.time) - minutesOf(k.time) + 20) * PX)}px">Game</div>` : "";
  const evs = t.entries.map((e, i) => ({ i, e, s: minutesOf(e.time), d: DUR[e.phase] || 30 })).sort((a, b) => a.s - b.s);
  // Side-by-side lanes for overlapping blocks.
  let cluster = [], end = -1;
  const lanes = (cl) => { const ends = []; cl.forEach((ev) => { let l = 0; while (l < ends.length && ends[l] > ev.s) l++; ev.lane = l; ends[l] = ev.s + ev.d; }); cl.forEach((ev) => (ev.lanes = Math.max(1, ends.length))); };
  evs.forEach((ev) => { if (cluster.length && ev.s >= end) { lanes(cluster); cluster = []; end = -1; } cluster.push(ev); end = Math.max(end, ev.s + ev.d); });
  if (cluster.length) lanes(cluster);
  const blocks = evs.map((ev) => {
    const w = 100 / ev.lanes;
    return `<button type="button" class="calevent ${COLOR[ev.e.phase] || "wake"}" data-act="calDetail" data-i="${ev.i}"
      style="top:${(ev.s - lo) * PX}px;height:${Math.max(34, ev.d * PX)}px;left:calc(${ev.lane * w}% + 2px);width:calc(${w}% - 4px)">
      <span class="cet">${esc(to12(ev.e.time))}</span><span class="cep">${esc(ev.e.phase)}</span></button>`;
  }).join("");
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const now = isToday && nowM >= lo && nowM <= hi ? `<div class="nowline" style="top:${(nowM - lo) * PX}px"></div>` : "";
  return `<div class="cal"><div class="calgutter" style="height:${H}px">${labels}</div><div class="calcanvas" style="height:${H}px">${lines}${band}${blocks}${now}</div></div>
    <div class="msg info" id="calDetail">Tap a block to see what to eat or drink then.</div>`;
}

// ---- calendar export ----
function addMin(iso, min) {
  const [d, tm] = iso.split("T"); const [h, m] = tm.split(":").map(Number);
  const b = new Date(d + "T00:00:00"); b.setMinutes(h * 60 + m + min);
  return `${toDateStr(b)}T${String(b.getHours()).padStart(2, "0")}:${String(b.getMinutes()).padStart(2, "0")}`;
}
const stamp = (s) => s.replace(/[-:]/g, "") + "00";
const icsEsc = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

export const actions = {
  toggleRow(btn) {
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    btn.nextElementSibling.hidden = open;
  },
  gdView(btn) {
    const v = btn.dataset.v; storeSet("gdView", v);
    document.getElementById("gdList").hidden = v !== "list";
    document.getElementById("gdCal").hidden = v !== "cal";
    btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
  },
  calDetail(btn) {
    const e = current?.entries[Number(btn.dataset.i)];
    if (!e) return;
    document.getElementById("calDetail").innerHTML = `<b>${esc(to12(e.time))} · ${esc(e.phase)}</b><br>${esc(e.title)}. ${esc(e.detail)}${e.foods?.length ? `<br>Try: ${e.foods.map(esc).join(", ")}` : ""}`;
  },
  downloadIcs() {
    const t = current; if (!t) return;
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AthletePerformance//EN", "CALSCALE:GREGORIAN"];
    t.calendar.forEach((ev, i) => L.push("BEGIN:VEVENT", `UID:${t.profileId}-${i}-${t.date}@athlete-performance`, `DTSTAMP:${stamp(new Date().toISOString().slice(0, 16))}`,
      `DTSTART:${stamp(ev.start)}`, `DTEND:${stamp(addMin(ev.start, ev.durationMin))}`, `SUMMARY:${icsEsc(ev.title)}`, `DESCRIPTION:${icsEsc(ev.description || "")}`,
      "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(ev.title)}`, "END:VALARM", "END:VEVENT"));
    L.push("END:VCALENDAR");
    const url = URL.createObjectURL(new Blob([L.join("\r\n")], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `game-day-${t.date}.ics` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  gcal() {
    const ev = current?.calendar?.[0]; if (!ev) return;
    const u = new URL("https://calendar.google.com/calendar/render");
    u.searchParams.set("action", "TEMPLATE"); u.searchParams.set("text", ev.title);
    u.searchParams.set("dates", `${stamp(ev.start)}/${stamp(addMin(ev.start, ev.durationMin))}`);
    u.searchParams.set("details", current.calendar.map((c) => `${to12(c.start.slice(11))} ${c.title}: ${c.description}`).join("\n"));
    window.open(u.toString(), "_blank", "noopener");
  },
};

