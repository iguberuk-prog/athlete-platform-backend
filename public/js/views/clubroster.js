// Club console, two tabs used by club.js:
//   Players: every athlete in the club by team, with check-in status, flags, search, CSV export, removal.
//   Import:  bulk onboarding. Paste or upload the club's roster file, pick the team (or use a Team
//            column for the whole club at once), preview, import. Each row becomes a one-time invite
//            link that pre-fills the family's setup. Directors see, copy, share, print and cancel links.

import { $, esc, todayStr, niceDate, relDay, daysBetween, msg, toast, avatar } from "../ui.js";
import { api, errText } from "../api.js";

let club = null, role = null, teams = [];
let rosterData = null;   // last GET /roster
let invites = null;      // last GET /roster/imports
let parsed = null;       // the roster file after parsing
let lastImport = null;   // summary of the last import run (shown once)
let rerenderTab = () => {};

export function setContext(ctx) { club = ctx.club; role = ctx.role; teams = ctx.teams || []; rerenderTab = ctx.rerender || rerenderTab; }
const canManage = () => role === "director" || role === "coach";
const isDirector = () => role === "director";

// ---------------------------------------------------------------------------
// Players tab
// ---------------------------------------------------------------------------
export async function rosterTab(box) {
  const res = await api(`/api/clubs/${club.id}/roster?date=${todayStr()}`);
  if (!res.ok) { box.innerHTML = msg("err", errText(res)); return; }
  rosterData = res.data;
  const d = rosterData;
  const teamNames = [...new Set(d.rows.map((x) => x.team))].sort();
  const checked = d.rows.filter((x) => x.checkedInToday).length;
  const notCleared = d.rows.filter((x) => x.notCleared).length;
  const injured = d.rows.filter((x) => x.injured).length;
  box.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">Players</div><div class="v">${d.totalPlayers}</div><div class="u">${d.teams} team${d.teams === 1 ? "" : "s"}</div></div>
      <div class="stat"><div class="k">Checked in today</div><div class="v">${checked}</div><div class="u">${d.totalPlayers ? Math.round((checked / d.totalPlayers) * 100) : 0}% of players</div></div>
      <div class="stat"><div class="k">Not cleared</div><div class="v" style="${notCleared ? "color:var(--bad)" : ""}">${notCleared}</div><div class="u">concussion protocol</div></div>
      <div class="stat"><div class="k">Injury on file</div><div class="v" style="${injured ? "color:var(--warn)" : ""}">${injured}</div><div class="u">details stay private</div></div>
    </div>
    ${d.totalPlayers ? `
    <div class="card" style="margin-top:12px">
      <div class="row2"><input class="input" id="rsSearch" type="search" placeholder="Search by name or ID" autocomplete="off" aria-label="Search players">
        <select class="input" id="rsTeam" aria-label="Team"><option value="">All teams</option>${teamNames.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
      <div class="row2" style="margin-top:8px"><select class="input" id="rsStatus" aria-label="Status"><option value="">Everyone</option><option value="today">Checked in today</option><option value="week">No check-in this week</option><option value="never">Never checked in</option><option value="flag">Not cleared or injured</option></select>
        <button class="btn ghost" data-act="rosterExport">Download CSV</button></div>
      <div id="rsCount" class="rowsub" style="margin:12px 0 2px"></div>
      <div id="rsRows"></div>
    </div>` : `
    <div class="card empty" style="margin-top:12px"><div class="big">No players yet</div>
      <p>Import the club roster and every family gets a personal link that puts their player on the right team. Or share a team's join code.</p>
      ${canManage() ? `<button class="btn primary" data-act="clubTab" data-k="import">Import a roster</button>` : ""}</div>`}`;
  if (d.totalPlayers) {
    $("#rsSearch").addEventListener("input", renderRosterRows);
    $("#rsTeam").addEventListener("change", renderRosterRows);
    $("#rsStatus").addEventListener("change", renderRosterRows);
    renderRosterRows();
  }
}

function filteredRoster() {
  const q = ($("#rsSearch")?.value || "").trim().toLowerCase();
  const team = $("#rsTeam")?.value || "";
  const st = $("#rsStatus")?.value || "";
  const today = todayStr();
  return rosterData.rows.filter((r) => {
    if (team && r.team !== team) return false;
    if (q && !`${r.name} ${r.playerCode || ""}`.toLowerCase().includes(q)) return false;
    if (st === "today") return r.checkedInToday;
    if (st === "week") return !r.lastCheckin || daysBetween(r.lastCheckin, today) >= 7;
    if (st === "never") return !r.lastCheckin;
    if (st === "flag") return r.notCleared || r.injured;
    return true;
  });
}

function checkinPill(r) {
  if (r.checkedInToday) return `<span class="pill ready"><span class="dot"></span>Checked in today</span>`;
  if (!r.lastCheckin) return `<span class="pill neutral"><span class="dot"></span>Never checked in</span>`;
  const days = daysBetween(r.lastCheckin, todayStr());
  return `<span class="pill ${days >= 7 ? "moderate" : "neutral"}"><span class="dot"></span>Last check-in ${esc(days > 7 ? niceDate(r.lastCheckin) : relDay(r.lastCheckin).toLowerCase())}</span>`;
}

const SHOW_MAX = 250;
function renderRosterRows() {
  const rows = filteredRoster();
  const el = $("#rsRows");
  if (!el) return;
  $("#rsCount").textContent = rows.length === rosterData.rows.length ? `${rows.length} player${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${rosterData.rows.length} players`;
  el.innerHTML = rows.slice(0, SHOW_MAX).map((r) => `
    <div class="player">${avatar({ identity: { fullName: r.name } }, "md")}
      <div class="pm">
        <div class="pn">${esc(r.name)}${r.playerCode ? ` <span class="dim small">${esc(r.playerCode)}</span>` : ""}</div>
        <div class="pd">${esc(r.team)}</div>
        <div style="margin-top:6px">${checkinPill(r)}
          ${r.notCleared ? `<span class="pill low"><span class="dot"></span>Not cleared</span>` : ""}
          ${r.injured ? `<span class="pill moderate"><span class="dot"></span>Injury on file</span>` : ""}</div>
      </div>
      ${canManage() ? `<button class="btn ghost sm" data-act="rosterRemove" data-team="${esc(r.teamId)}" data-id="${esc(r.profileId)}" data-name="${esc(r.name)}" aria-label="Remove ${esc(r.name)}">Remove</button>` : ""}
    </div>`).join("") || `<p class="sub">Nobody matches. Clear the search or pick another team.</p>`;
  if (rows.length > SHOW_MAX) el.insertAdjacentHTML("beforeend", `<p class="sub" style="margin-top:10px">Showing the first ${SHOW_MAX}. Narrow the search or pick a team to see the rest, or download the CSV.</p>`);
}

// ---------------------------------------------------------------------------
// Import tab
// ---------------------------------------------------------------------------
export async function importTab(box) {
  const res = await api(`/api/clubs/${club.id}/roster/imports`);
  invites = res.ok ? res.data : { total: 0, pending: 0, joined: 0, rows: [] };
  const result = lastImport; lastImport = null;
  box.innerHTML = `
    ${result ? importResult(result) : ""}
    ${canManage() ? importForm() : ""}
    ${invitesCard()}`;
  if (canManage()) wireImportForm(box);
  wireInvites(box);
}

function importResult(r) {
  const parts = [];
  parts.push(r.created ? `<b>${r.created} invite${r.created === 1 ? "" : "s"} created</b> on ${esc(r.teams.join(", "))}.` : `<b>Nothing was imported.</b>`);
  if (r.emailed) parts.push(`${r.emailed} emailed to parents.`);
  if (r.withEmail > r.emailed) parts.push(r.emailed === 0 && r.withEmail > 0
    ? `Email isn't switched on for this site yet, so nothing was sent. Copy or share the links below, or ask the site owner to add RESEND_API_KEY and EMAIL_FROM in Netlify.`
    : `${r.withEmail - r.emailed} could not be emailed; share their links below.`);
  if (r.noEmail) parts.push(`${r.noEmail} had no parent email: share their links below or print the QR sheet.`);
  const errs = r.errors.length ? `<div class="small" style="margin-top:8px;color:var(--warn)">Skipped rows: ${r.errors.slice(0, 8).map((e) => `row ${e.row} (${esc(e.reason)})`).join(", ")}${r.errors.length > 8 ? ` and ${r.errors.length - 8} more` : ""}</div>` : "";
  return `<div class="msg ${r.created ? "ok" : "err"}" style="margin:0 0 12px">${parts.join(" ")}${errs}</div>`;
}

function importForm() {
  return `
    <form class="card" data-submit="rosterImport" novalidate>
      <h3>Import a roster</h3>
      <p class="sub">Use the club's registration export or any spreadsheet with a header row: <b>Player</b> (or First and Last), <b>Date of birth</b>, <b>Parent email</b>, <b>Jersey</b>, <b>Team</b>. Only the name is required. Up to 2,000 players at a time.</p>
      <label class="f" for="impTeam">Which team?</label>
      <select class="input" id="impTeam">
        <option value="__column">Use the Team column in the file (whole club at once)</option>
        ${teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.ageGroup ? ` (${esc(t.ageGroup)})` : ""}</option>`).join("")}
        <option value="__new">New team…</option>
      </select>
      <div class="row2" id="impNewTeam" hidden style="margin-top:8px"><input class="input" id="impTeamName" placeholder="Team name, e.g. STA U13 Girls" maxlength="80"><input class="input" id="impAge" placeholder="Age group, e.g. U13" maxlength="20"></div>
      <label class="f" for="impText" style="margin-top:12px">Roster</label>
      <label class="btn ghost block filebtn">Choose a file (Excel or CSV)<input type="file" id="impFile" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden></label>
      <textarea class="input" id="impText" rows="5" placeholder="…or paste rows straight from the spreadsheet (header row first)" style="margin-top:8px"></textarea>
      <div class="row2" style="margin-top:8px">
        <a class="btn link" download="roster-template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent("Player,Date of birth,Parent email,Jersey,Team\nJosh Guberuk,2010-03-02,parent@email.com,8,STA U16 Boys\n")}">Download a template</a>
        <button class="btn ghost" type="button" data-act="rosterPreview">Preview</button>
      </div>
      <div id="impPreview"></div>
      <div class="actions"><button class="btn primary block" type="submit" id="impGo" disabled>Preview first</button></div>
      <p class="disc">Families get a personal link that fills in the name, birthday and team. They add food safety themselves. Nothing medical is ever in the file you upload.</p>
    </form>`;
}

function wireImportForm(box) {
  const sel = $("#impTeam", box);
  sel.addEventListener("change", () => { $("#impNewTeam").hidden = sel.value !== "__new"; if (parsed) renderPreview(); });
  $("#impFile", box).addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      $("#impText").value = /\.xlsx?$/i.test(f.name) ? await excelToCsv(f) : await f.text();
    } catch (err) { toast(`Couldn't read that file: ${err.message || err}`, 6000); return; }
    parseAndPreview();
  });
  const ta = $("#impText", box);
  ta.addEventListener("input", () => { parsed = null; $("#impPreview").innerHTML = ""; $("#impGo").disabled = true; $("#impGo").textContent = "Preview first"; });
  ta.addEventListener("paste", () => setTimeout(parseAndPreview, 60));
}

/** Excel workbooks: read the first sheet as text. Dates come through as displayed (3/2/2010), which the parser handles. */
async function excelToCsv(file) {
  if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload = res; s.onerror = () => rej(new Error("the spreadsheet reader didn't load. Save as CSV and try again.")); document.head.appendChild(s); });
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("the workbook has no sheets.");
  return window.XLSX.utils.sheet_to_csv(ws, { blankrows: false });
}

// ---- roster file parsing ----------------------------------------------------
function splitRows(text) {
  // Handles quoted fields, CRLF, and comma / tab / semicolon delimiters (spreadsheet paste is tab-separated).
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/)[0] || "";
  const delim = (firstLine.match(/\t/g) || []).length ? "\t" : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

const H = {
  name: /^(player|athlete|full ?name|name|player ?name|athlete ?name|child|student)$/i,
  first: /^(first|first ?name|given ?name|player first|athlete first)$/i,
  last: /^(last|last ?name|surname|family ?name|player last|athlete last)$/i,
  dob: /^(dob|d\.o\.b\.|date ?of ?birth|birth ?date|birthday|born)$/i,
  email: /^(parent ?e-?mail|guardian ?e-?mail|parent1? ?e-?mail|family ?e-?mail|e-?mail|email ?address|parent)$/i,
  jersey: /^(jersey|jersey ?#|jersey ?number|number|#|no\.?|kit)$/i,
  team: /^(team|team ?name|squad|roster|age ?group|division)$/i,
};
function detectColumns(header) {
  const map = {};
  header.forEach((h, i) => { for (const k of Object.keys(H)) if (map[k] === undefined && H[k].test(h.trim())) map[k] = i; });
  return map;
}
function toISODate(s) {
  s = String(s || "").trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += y > 30 ? 1900 : 2000;
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; // US order: month/day/year
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
const ageGroupOf = (team) => { const m = String(team || "").match(/\bU-?(\d{1,2})\b/i); return m ? `U${m[1]}` : undefined; };

function parseRoster(text) {
  const rows = splitRows(text);
  if (!rows.length) return { error: "Paste or choose the roster first." };
  let header = rows[0], body = rows.slice(1), map = detectColumns(header), headerless = false;
  if (map.name === undefined && map.first === undefined) {
    // No header row: treat the first column as the name and anything that looks like a date / email as such.
    headerless = true; body = rows; header = [];
    map = { name: 0 };
    const probe = rows[0];
    probe.forEach((c, i) => { if (i && map.email === undefined && /@/.test(c)) map.email = i; else if (i && map.dob === undefined && toISODate(c) && /\d/.test(c) && !/^\d{1,3}$/.test(c)) map.dob = i; else if (i && map.jersey === undefined && /^\d{1,3}$/.test(c)) map.jersey = i; });
  }
  const athletes = body.map((r, i) => {
    const name = map.name !== undefined ? r[map.name] : [r[map.first], r[map.last]].filter(Boolean).join(" ");
    const email = map.email !== undefined ? r[map.email] : "";
    const jerseyRaw = map.jersey !== undefined ? String(r[map.jersey] ?? "").replace(/\D/g, "") : "";
    const jersey = jerseyRaw ? Number(jerseyRaw) : NaN;
    return {
      line: i + (headerless ? 1 : 2),
      fullName: String(name || "").replace(/\s+/g, " ").trim().slice(0, 80),
      dateOfBirth: map.dob !== undefined ? toISODate(r[map.dob]) : undefined,
      parentEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.toLowerCase() : undefined,
      jerseyNumber: Number.isFinite(jersey) && jersey >= 0 && jersey < 1000 ? jersey : undefined,
      team: map.team !== undefined ? String(r[map.team] || "").trim().slice(0, 80) : "",
    };
  });
  return { header, map, headerless, athletes, delimiter: "" };
}

function parseAndPreview() {
  const text = $("#impText").value;
  const p = parseRoster(text);
  if (p.error) { $("#impPreview").innerHTML = msg("err", p.error); parsed = null; return; }
  parsed = p;
  renderPreview();
}

function groupsForImport() {
  // Returns [{ teamId?, teamName?, ageGroup?, label, rows }] or an error string.
  const mode = $("#impTeam").value;
  const good = parsed.athletes.filter((a) => a.fullName);
  if (mode === "__column") {
    if (parsed.map.team === undefined) return "The file has no Team column. Pick a team above, or add a Team column.";
    const byTeam = new Map();
    for (const a of good) { const k = a.team || "(no team)"; if (!byTeam.has(k)) byTeam.set(k, []); byTeam.get(k).push(a); }
    if (byTeam.has("(no team)")) return `${byTeam.get("(no team)").length} row${byTeam.get("(no team)").length === 1 ? " has" : "s have"} an empty Team cell. Fill them in, or pick one team above for the whole file.`;
    return [...byTeam.entries()].map(([name, rows]) => {
      const existing = teams.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
      return existing ? { teamId: existing.id, label: existing.name, rows } : { teamName: name, ageGroup: ageGroupOf(name), label: `${name} (new team)`, rows };
    });
  }
  if (mode === "__new") {
    const name = ($("#impTeamName").value || "").trim();
    if (!name) return "Give the new team a name.";
    return [{ teamName: name, ageGroup: ($("#impAge").value || "").trim() || ageGroupOf(name), label: `${name} (new team)`, rows: good }];
  }
  const t = teams.find((x) => x.id === mode);
  return t ? [{ teamId: t.id, label: t.name, rows: good }] : "Pick a team.";
}

function renderPreview() {
  const p = parsed, box = $("#impPreview"), go = $("#impGo");
  if (!p || !box) return;
  const good = p.athletes.filter((a) => a.fullName), bad = p.athletes.length - good.length;
  const withEmail = good.filter((a) => a.parentEmail).length, withDob = good.filter((a) => a.dateOfBirth).length;
  const col = (k) => (p.map[k] !== undefined ? `<b>${esc(p.header[p.map[k]] || `column ${p.map[k] + 1}`)}</b>` : `<span class="dim">not found</span>`);
  const groups = groupsForImport();
  const groupErr = typeof groups === "string" ? groups : "";
  box.innerHTML = `
    <div class="card tight" style="background:var(--bg2);margin:12px 0 0">
      <div class="rowtitle">${good.length} player${good.length === 1 ? "" : "s"} found${bad ? ` <span class="dim">· ${bad} row${bad === 1 ? "" : "s"} without a name skipped</span>` : ""}</div>
      <div class="small" style="margin-top:6px">Name: ${p.map.name !== undefined ? col("name") : p.map.first !== undefined ? `${col("first")} + ${col("last")}` : `<span class="dim">first column</span>`} · Birthday: ${col("dob")} (${withDob} of ${good.length}) · Parent email: ${col("email")} (${withEmail} of ${good.length}) · Jersey: ${col("jersey")} · Team: ${col("team")}</div>
      ${p.headerless ? `<div class="small" style="color:var(--warn);margin-top:6px">No header row found, so the first column was used as the name. Add a header row for birthdays and emails.</div>` : ""}
      ${groupErr ? `<div class="small" style="color:var(--bad);margin-top:6px">${esc(groupErr)}</div>` : `<div class="small" style="margin-top:6px">Goes to: ${groups.map((g) => `<b>${esc(g.label)}</b> (${g.rows.length})`).join(", ")}</div>`}
      <table class="data" style="margin-top:8px"><thead><tr><td>Player</td><td>Birthday</td><td>Parent email</td><td>#</td>${p.map.team !== undefined ? "<td>Team</td>" : ""}</tr></thead><tbody>
        ${good.slice(0, 6).map((a) => `<tr><td>${esc(a.fullName)}</td><td>${a.dateOfBirth ? esc(niceDate(a.dateOfBirth, { month: "short", day: "numeric", year: "numeric" })) : "<span class='dim'>none</span>"}</td><td>${esc(a.parentEmail || "")}${a.parentEmail ? "" : "<span class='dim'>none</span>"}</td><td>${a.jerseyNumber ?? ""}</td>${p.map.team !== undefined ? `<td>${esc(a.team)}</td>` : ""}</tr>`).join("")}
        ${good.length > 6 ? `<tr><td colspan="5" class="dim">and ${good.length - 6} more</td></tr>` : ""}</tbody></table>
    </div>`;
  go.disabled = !good.length || !!groupErr;
  go.textContent = good.length ? `Import ${good.length} player${good.length === 1 ? "" : "s"}` : "Nothing to import";
}

// ---- invites list ------------------------------------------------------------
function inviteFiltered() {
  const q = ($("#invSearch")?.value || "").trim().toLowerCase();
  const team = $("#invTeam")?.value || "";
  const st = $("#invStatus")?.value || "pending";
  return invites.rows.filter((r) => (st === "all" || r.status === st) && (!team || r.team === team) && (!q || `${r.fullName} ${r.parentEmail || ""}`.toLowerCase().includes(q)));
}

function invitesCard() {
  const inv = invites;
  if (!inv.total) return `<div class="card"><h3>Invites</h3><p class="sub" style="margin:0">No invites yet. ${canManage() ? "Import a roster above and every player gets a personal link." : "The director or a coach imports the roster; invites show up here."}</p></div>`;
  const teamNames = [...new Set(inv.rows.map((r) => r.team))].sort();
  return `
    <div class="card">
      <h3>Invites</h3>
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><div class="k">Joined</div><div class="v" style="color:var(--good)">${inv.joined}</div><div class="u">of ${inv.total} invited</div></div>
        <div class="stat"><div class="k">Still pending</div><div class="v" style="${inv.pending ? "color:var(--warn)" : ""}">${inv.pending}</div><div class="u">${inv.total ? Math.round((inv.joined / inv.total) * 100) : 0}% joined</div></div>
      </div>
      <div class="bar" style="margin-bottom:12px"><i style="width:${inv.total ? Math.round((inv.joined / inv.total) * 100) : 0}%"></i></div>
      <div class="row2"><input class="input" id="invSearch" type="search" placeholder="Search invites" autocomplete="off" aria-label="Search invites">
        <select class="input" id="invTeam" aria-label="Team"><option value="">All teams</option>${teamNames.map((t) => `<option>${esc(t)}</option>`).join("")}</select></div>
      <div class="row2" style="margin-top:8px"><select class="input" id="invStatus" aria-label="Status"><option value="pending" ${inv.pending ? "selected" : ""}>Pending</option><option value="joined">Joined</option><option value="all" ${inv.pending ? "" : "selected"}>All</option></select>
        ${isDirector() ? `<button class="btn ghost" data-act="inviteCopyAll">Copy pending links</button>` : `<span class="small dim" style="align-self:center">Links are shown to the director.</span>`}</div>
      ${isDirector() ? `<div class="row2" style="margin-top:8px"><button class="btn ghost" data-act="inviteCsv">Download links (CSV)</button><button class="btn ghost" data-act="invitePrint">Print QR sheet</button></div>` : ""}
      <div id="invCount" class="rowsub" style="margin:12px 0 2px"></div>
      <div id="invRows"></div>
      ${isDirector() ? `<p class="disc">Each link works once and is meant for one family. The CSV is ready for a mail merge; the QR sheet is for registration night or the first practice.</p>` : ""}
    </div>
    <div id="invPrint" class="printable" hidden></div>`;
}

function wireInvites(box) {
  if (!invites.total) return;
  ["invSearch", "invTeam", "invStatus"].forEach((id) => $("#" + id, box)?.addEventListener(id === "invSearch" ? "input" : "change", renderInviteRows));
  renderInviteRows();
}

function renderInviteRows() {
  const el = $("#invRows");
  if (!el) return;
  const rows = inviteFiltered();
  $("#invCount").textContent = `${rows.length} invite${rows.length === 1 ? "" : "s"}`;
  const share = !!navigator.share;
  el.innerHTML = rows.slice(0, SHOW_MAX).map((r) => `
    <div class="player">${avatar({ identity: { fullName: r.fullName } }, "md")}
      <div class="pm">
        <div class="pn">${esc(r.fullName)}${r.jerseyNumber != null ? ` <span class="dim">#${esc(r.jerseyNumber)}</span>` : ""}</div>
        <div class="pd">${esc(r.team)}${r.parentEmail ? ` · ${esc(r.parentEmail)}` : isDirector() && r.status === "pending" ? ` · <span style="color:var(--warn)">no parent email</span>` : ""}</div>
        <div style="margin-top:6px">${r.status === "joined"
          ? `<span class="pill ready"><span class="dot"></span>Joined ${esc(r.joinedAt ? relDay(r.joinedAt.slice(0, 10)).toLowerCase() : "")}</span>`
          : `<span class="pill moderate"><span class="dot"></span>Pending · invited ${esc(relDay(r.invitedAt.slice(0, 10)).toLowerCase())}</span>`}</div>
        ${r.inviteLink ? `<div class="actions" style="margin-top:8px;gap:6px">
          <button class="btn ghost sm" data-act="inviteCopy" data-link="${esc(r.inviteLink)}">Copy link</button>
          ${share ? `<button class="btn ghost sm" data-act="inviteShare" data-link="${esc(r.inviteLink)}" data-name="${esc(r.fullName)}" data-team="${esc(r.team)}">Share</button>` : r.parentEmail ? `<a class="btn ghost sm" href="mailto:${esc(r.parentEmail)}?subject=${encodeURIComponent(`${r.fullName}: join ${r.team} on Athlete Performance`)}&body=${encodeURIComponent(inviteText(r))}">Email</a>` : ""}
          <button class="btn ghost sm" data-act="inviteRevoke" data-token="${esc(r.token || "")}" data-name="${esc(r.fullName)}">Cancel</button></div>` : ""}
      </div>
    </div>`).join("") || `<p class="sub">No invites match.</p>`;
  if (rows.length > SHOW_MAX) el.insertAdjacentHTML("beforeend", `<p class="sub" style="margin-top:10px">Showing the first ${SHOW_MAX}. Narrow the search or download the CSV.</p>`);
}

const inviteText = (r) => `${club.name} invites ${r.fullName} to join ${r.team} on Athlete Performance: game-day fuel, recovery, sleep and daily check-ins for players. Set up ${r.fullName.split(" ")[0]}'s account here (the name and team are already filled in): ${r.inviteLink}`;

function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

async function qrSvg(text, cell = 3) {
  if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 1, scalable: true });
}

export const actions = {
  rosterExport() {
    const rows = filteredRoster();
    download(`${club.name.replace(/[^\w]+/g, "-")}-players.csv`, csv([["Player", "Player ID", "Team", "Last check-in", "Checked in today", "Not cleared", "Injury on file"],
      ...rows.map((r) => [r.name, r.playerCode || "", r.team, r.lastCheckin || "", r.checkedInToday ? "yes" : "no", r.notCleared ? "yes" : "no", r.injured ? "yes" : "no"])]));
  },
  async rosterRemove(btn) {
    if (!confirm(`Remove ${btn.dataset.name} from ${rosterData.rows.find((r) => r.profileId === btn.dataset.id)?.team || "the team"}? Their profile and data stay with the family.`)) return;
    const r = await api(`/api/clubs/${club.id}/roster/remove`, { method: "POST", body: { teamId: btn.dataset.team, profileId: btn.dataset.id } });
    if (!r.ok) return toast(errText(r));
    toast("Removed"); rerenderTab();
  },
  rosterPreview: () => parseAndPreview(),
  async rosterImport(form) {
    if (!parsed) parseAndPreview();
    if (!parsed) return;
    const groups = groupsForImport();
    if (typeof groups === "string") return toast(groups, 5000);
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    if (!total) return toast("No players to import.");
    if (total > 2000) return toast("Import up to 2,000 players at a time. Split the file.", 5000);
    if (!confirm(`Import ${total} player${total === 1 ? "" : "s"} into ${groups.map((g) => g.label).join(", ")}? Each gets a one-time invite link${groups.some((g) => g.rows.some((a) => a.parentEmail)) ? ", and parents with an email on file are emailed" : ""}.`)) return;
    const go = $("#impGo"); go.disabled = true; go.textContent = "Importing…";
    const result = { created: 0, emailed: 0, withEmail: 0, noEmail: 0, errors: [], teams: [] };
    for (const g of groups) {
      const body = { teamId: g.teamId, teamName: g.teamName, ageGroup: g.ageGroup, rows: g.rows.map((a) => ({ fullName: a.fullName, dateOfBirth: a.dateOfBirth, parentEmail: a.parentEmail, jerseyNumber: a.jerseyNumber })) };
      const r = await api(`/api/clubs/${club.id}/roster/import`, { method: "POST", body });
      if (!r.ok) { toast(`${g.label}: ${errText(r)}`, 6000); continue; }
      result.created += r.data.created; result.emailed += r.data.emailed; result.teams.push(r.data.teamName);
      result.withEmail += g.rows.filter((a) => a.parentEmail).length; result.noEmail += g.rows.filter((a) => !a.parentEmail).length;
      result.errors.push(...r.data.errors);
      if (g.teamName && !teams.some((t) => t.id === r.data.teamId)) teams.push({ id: r.data.teamId, name: r.data.teamName, ageGroup: g.ageGroup });
    }
    lastImport = result; parsed = null;
    toast(result.created ? `${result.created} invite${result.created === 1 ? "" : "s"} created` : "Nothing was imported");
    rerenderTab();
  },
  async inviteCopy(btn) {
    try { await navigator.clipboard.writeText(btn.dataset.link); toast("Link copied"); } catch { prompt("Copy this link", btn.dataset.link); }
  },
  async inviteShare(btn) {
    const r = { fullName: btn.dataset.name, team: btn.dataset.team, inviteLink: btn.dataset.link };
    try { await navigator.share({ title: `${r.fullName}: join ${r.team}`, text: inviteText(r), url: r.inviteLink }); } catch {}
  },
  async inviteRevoke(btn) {
    if (!btn.dataset.token) return;
    if (!confirm(`Cancel ${btn.dataset.name}'s invite? The link stops working. You can import them again later.`)) return;
    const r = await api(`/api/clubs/${club.id}/roster/revoke`, { method: "POST", body: { token: btn.dataset.token } });
    if (!r.ok) return toast(errText(r));
    toast("Invite cancelled"); rerenderTab();
  },
  async inviteCopyAll() {
    const rows = invites.rows.filter((r) => r.status === "pending" && r.inviteLink);
    if (!rows.length) return toast("No pending links.");
    const text = rows.map((r) => `${r.fullName}\t${r.team}\t${r.parentEmail || ""}\t${r.inviteLink}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`${rows.length} links copied. Paste into a spreadsheet or email.`); } catch { download("invite-links.txt", text, "text/plain"); }
  },
  inviteCsv() {
    const rows = invites.rows.filter((r) => r.inviteLink || r.status === "joined");
    download(`${club.name.replace(/[^\w]+/g, "-")}-invite-links.csv`, csv([["Player", "Team", "Parent email", "Status", "Invite link"], ...rows.map((r) => [r.fullName, r.team, r.parentEmail || "", r.status, r.inviteLink || ""])]));
  },
  async invitePrint() {
    const rows = inviteFiltered().filter((r) => r.inviteLink);
    if (!rows.length) return toast("No pending links to print. Set the status filter to Pending.");
    if (rows.length > 120 && !confirm(`Print ${rows.length} QR cards?`)) return;
    const box = $("#invPrint");
    box.hidden = false;
    box.innerHTML = `<div class="eh">${esc(club.name)} · Athlete Performance invites · ${esc(new Date().toLocaleDateString())}</div><p class="small">One card per family. Scan the code with the phone camera, or type the link.</p><div class="qrgrid">${msg("info", "Building QR codes…")}</div>`;
    const cards = [];
    for (const r of rows) cards.push(`<div class="qrcard"><div>${await qrSvg(r.inviteLink)}</div><div><b>${esc(r.fullName)}</b><div class="small">${esc(r.team)}</div><div class="small" style="word-break:break-all">${esc(r.inviteLink)}</div></div></div>`);
    box.querySelector(".qrgrid").innerHTML = cards.join("");
    const after = () => { box.hidden = true; window.removeEventListener("afterprint", after); };
    window.addEventListener("afterprint", after);
    document.body.classList.add("printInvites");
    setTimeout(() => { window.print(); document.body.classList.remove("printInvites"); }, 150);
  },
};
