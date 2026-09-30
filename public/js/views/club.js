// Club: start or join a club, then (by role) dashboard, teams, staff and
// certifications, fields, medical roster and concussion log, branding, billing.

import { $, esc, todayStr, niceDate, msg, toast, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { render as rerender } from "../app.js";
import { isNative } from "../native.js";

const CERT = { safesport: "SafeSport", cpr_first_aid: "CPR / First Aid", concussion_training: "Concussion training", background_check: "Background check", coaching_license: "Coaching license", athletic_trainer_license: "AT license" };
const ROLE = { director: "Director", coach: "Coach", trainer: "Athletic trainer" };
const list = (xs) => `<ul class="list">${xs.map((t) => `<li><span class="bullet"></span><div>${t}</div></li>`).join("")}</ul>`;
let club = null, role = null, tab = null;

export async function render(el, ctx) {
  if (!ctx.sub) return home(el, ctx);
  const r = await api(`/api/clubs/${ctx.sub}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  ({ club, role } = r.data);
  const tabs = [
    ...(role !== "coach" ? [["dash", "Dashboard"], ["medical", "Medical"]] : []),
    ["teams", "Teams"], ["staff", "Staff"], ["fields", "Fields"],
    ...(role === "director" ? [["settings", "Settings"]] : []),
  ];
  tab = tabs.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : storeGet(`clubTab:${club.id}`, tabs[0][0]);
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  const billingMsg = ctx.query.billing === "ok" ? msg("ok", "Thanks! Your club plan is active.") : ctx.query.billing === "cancel" ? msg("info", "Checkout canceled.") : "";
  el.innerHTML = `
    <section class="hero clubhero" style="${club.primary ? `--club:${club.primary};` : ""}">
      ${club.logoUrl ? `<img src="${esc(club.logoUrl)}" alt="" class="clublogo">` : ""}
      <div class="greet">${esc(ROLE[role])}</div><div class="headline">${esc(club.name)}</div>
      ${!r.data.active ? `<div class="note" style="color:#ffb0b0">Club plan inactive. Safety tools still work; dashboard, branding and camps need an active plan.</div>` : club.plan === "trial" ? `<div class="note">Free trial until ${esc(niceDate(club.trialEnds))}</div>` : ""}
    </section>
    ${billingMsg}
    <div class="seg scroll">${tabs.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" data-act="clubTab" data-k="${k}">${t}</button>`).join("")}</div>
    <div id="clubBody">${msg("info", "Loading…")}</div>`;
  await TABS[tab]($("#clubBody"));
}

async function home(el, ctx) {
  const r = await api("/api/clubs");
  if (!ctx.seq()) return;
  const clubs = r.ok ? r.data.clubs : [];
  el.innerHTML = `
    ${clubs.map((c) => `<button class="tile" data-act="nav" data-to="#/club/${c.club.id}"><span class="ic">${esc(c.club.name.slice(0, 1))}</span><span><div class="tt">${esc(c.club.name)}</div><div class="ts">${esc(ROLE[c.role])}${c.active ? "" : " · plan inactive"}</div></span><span class="chev">›</span></button>`).join("")}
    <form class="card" data-submit="clubJoin"><h3>Join your club's staff</h3><p class="sub">Enter the staff code from your club director.</p>
      <div class="row2"><input class="input" id="staffCode" placeholder="8-letter code" autocapitalize="characters"><input class="input" id="staffName" placeholder="Your name"></div>
      <div class="actions"><button class="btn primary block">Join</button></div></form>
    <form class="card" data-submit="clubCreate"><h3>Start a club</h3>
      <p class="sub">For club directors. Includes a club dashboard, medical roster, concussion log, certifications, field alerts and branding. 30 days free.</p>
      <input class="input" id="clubName" placeholder="Club name" maxlength="80">
      <input class="input" id="clubRef" placeholder="Referral code (optional)" style="margin-top:8px" autocapitalize="characters">
      <div class="actions"><button class="btn ghost block">Start a club</button></div></form>`;
}

const TABS = {
  async dash(box) {
    const r = await api(`/api/clubs/${club.id}/dashboard?date=${todayStr()}`);
    if (!r.ok) { box.innerHTML = msg("err", errText(r)); return; }
    const d = r.data, t = d.totals;
    box.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">Players</div><div class="v">${t.players}</div><div class="u">${t.teams} team${t.teams === 1 ? "" : "s"}</div></div>
        <div class="stat"><div class="k">Not cleared</div><div class="v" style="${t.notCleared ? "color:var(--bad)" : ""}">${t.notCleared}</div></div>
        <div class="stat"><div class="k">High risk</div><div class="v">${t.highRisk}</div></div>
        <div class="stat"><div class="k">Overloaded</div><div class="v">${t.overloaded}</div><div class="u">over hours or no day off</div></div>
      </div>
      ${d.onCall.length ? `<div class="msg ok" style="margin-top:12px"><b>On call:</b> ${d.onCall.map((o) => `${esc(o.name || "Trainer")}${o.location ? ` at ${esc(o.location)}` : ""}${o.phone ? ` · ${esc(o.phone)}` : ""}`).join("; ")}</div>` : ""}
      <div class="card" style="margin-top:12px"><h3>Fields today</h3>${d.fields.length ? d.fields.map((f) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${esc(f.name)} <span class="pill ${f.status === "open" ? "ready" : "low"}"><span class="dot"></span>${esc(f.status)}</span></div>
        <div class="rowsub">${esc(f.conditions?.headline || "No forecast")}</div>${f.warnings.map((w) => `<div class="small" style="color:var(--warn)">${esc(w)}</div>`).join("")}</div></div>`).join("") : `<p class="sub">Add your fields in the Fields tab to get heat, storm and air alerts.</p>`}</div>
      <div class="card"><h3>Teams</h3><table class="data"><thead><tr><td>Team</td><td>Check-ins (7 days)</td><td>Flags</td></tr></thead><tbody>
        ${d.teams.map((x) => `<tr><td>${esc(x.name)}<div class="rowsub">${x.players} players</div></td><td><div class="bar"><i style="width:${x.checkinRate7d}%"></i></div>${x.checkinRate7d}%</td>
          <td class="small">${[x.notCleared ? `${x.notCleared} not cleared` : "", x.highRisk ? `${x.highRisk} high risk` : "", x.overloaded ? `${x.overloaded} overloaded` : ""].filter(Boolean).join(", ") || "OK"}</td></tr>`).join("")}</tbody></table></div>
      ${d.certs.length ? `<div class="card"><h3>Certifications to fix</h3>${d.certs.map((c) => `<div class="jrow"><div><div class="rowtitle">${esc(c.name)} · ${esc(ROLE[c.role])}</div>
        <div class="small">${[...c.missing.map((m) => `${CERT[m]} missing`), ...c.expired.map((e) => `${CERT[e.type]} expired ${niceDate(e.expires)}`), ...c.expiring.map((e) => `${CERT[e.type]} expires ${niceDate(e.expires)}`)].map(esc).join(" · ")}</div></div></div>`).join("")}</div>` : ""}`;
  },

  async medical(box) {
    const [m, k] = await Promise.all([api(`/api/clubs/${club.id}/medical`), api(`/api/clubs/${club.id}/concussions`)]);
    if (!m.ok) { box.innerHTML = msg("err", errText(m)); return; }
    const rows = m.data.rows, trainer = m.data.role === "trainer";
    const teams = [...new Set(rows.map((r) => r.team))];
    box.innerHTML = `
      <div class="actions noprint" style="margin-top:0"><button class="btn primary" data-act="clubPrint">Print for tournament</button></div>
      <div class="printable"><div class="eh">${esc(club.name)} · medical and allergy roster · ${esc(new Date().toLocaleDateString())}</div>
      ${teams.map((t) => `<h3>${esc(t)}</h3><table class="data med"><thead><tr><td>Player</td><td>Allergies</td><td>Flags</td>${trainer ? "<td>Medical</td>" : ""}<td>Emergency</td></tr></thead><tbody>
        ${rows.filter((r) => r.team === t).map((r) => `<tr><td><b>${esc(r.name)}</b>${r.jersey != null ? ` #${r.jersey}` : ""}${r.age != null ? `<div class="rowsub">age ${r.age}</div>` : ""}</td>
          <td>${esc(r.allergies.join(", ") || "none")}</td>
          <td class="small">${[r.epinephrine ? "EpiPen" : "", r.asthma ? "Asthma" : "", ...r.medicalDiets.map((x) => x.replace(/_/g, " ")), r.concussion && !r.concussion.clearedAt ? `NOT CLEARED (step ${r.concussion.step})` : ""].filter(Boolean).map(esc).join(", ")}</td>
          ${trainer ? `<td class="small">${esc([...(r.conditions || []), ...(r.medications || []).map((x) => "Rx: " + x), ...(r.injuries || [])].join("; "))}</td>` : ""}
          <td class="small">${r.emergency ? `${esc(r.emergency.name || "")} ${esc(r.emergency.phone)}` : "<span style='color:var(--bad)'>missing</span>"}</td></tr>`).join("")}</tbody></table>`).join("") || `<p class="sub">No players on club teams yet.</p>`}</div>
      <div class="card noprint" style="margin-top:14px"><h3>Concussion log</h3>
        ${k.ok && k.data.length ? k.data.map((c) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${esc(c.name)} · ${esc(c.team)}</div>
          <div class="rowsub">${esc(niceDate(c.date))} · ${c.clearedAt ? `cleared ${esc(niceDate(c.clearedAt))}${c.clearedBy ? ` by ${esc(c.clearedBy)}` : ""}` : `step ${c.step} of 6, not cleared`}</div></div>
          ${trainer && !c.clearedAt && c.step >= 4 ? `<button class="btn primary sm" data-act="clubClear" data-id="${c.profileId}">Clear to play</button>` : ""}</div>`).join("") : `<p class="sub">No concussions recorded.</p>`}
        <p class="disc">Only a health care provider can clear a player. Athletic trainers' clearances are recorded with their name.</p></div>`;
  },

  async teams(box) {
    const r = await api(`/api/clubs/${club.id}/teams`);
    const teams = r.ok ? r.data.teams : [];
    box.innerHTML = `
      ${teams.map((t) => `<button class="tile" data-act="nav" data-to="#/team/${t.id}"><span class="ic">${t.players}</span><span><div class="tt">${esc(t.name)}</div><div class="ts">${t.ageGroup ? esc(t.ageGroup) + " · " : ""}code ${esc(t.code)}</div></span><span class="chev">›</span></button>`).join("") || `<p class="sub">No teams yet.</p>`}
      <form class="card" data-submit="clubTeam"><h3>New club team</h3><div class="row2"><input class="input" id="ctName" placeholder="Team name" maxlength="80"><input class="input" id="ctAge" placeholder="Age group, e.g. U12" maxlength="20"></div>
        <div class="actions"><button class="btn primary block">Create team</button></div><p class="disc">You coach teams you create. Share the join code or QR code with families.</p></form>`;
  },

  async staff(box) {
    const r = await api(`/api/clubs/${club.id}/staff?date=${todayStr()}`);
    if (!r.ok) { box.innerHTML = msg("err", errText(r)); return; }
    const me = r.data.find((s) => s.isMe) || null;
    box.innerHTML = `
      ${role === "director" ? `<div class="card"><h3>Invite staff</h3><div class="actions">${["coach", "trainer", "director"].map((x) => `<button class="btn ghost sm" data-act="clubInvite" data-role="${x}">${ROLE[x]} code</button>`).join("")}</div><div id="invOut"></div></div>` : ""}
      <div class="card"><h3>Staff</h3>${r.data.map((s) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${esc(s.name || s.email || "Staff")} · ${esc(ROLE[s.role])}${s.onCall?.active ? ` <span class="pill ready"><span class="dot"></span>On call</span>` : ""}</div>
        ${s.certReport ? `<div class="small">${[...s.certReport.missing.map((m) => `<span style="color:var(--bad)">${CERT[m]} missing</span>`), ...s.certReport.expired.map((e) => `<span style="color:var(--bad)">${CERT[e.type]} expired</span>`), ...s.certReport.expiring.map((e) => `<span style="color:var(--warn)">${CERT[e.type]} due ${esc(niceDate(e.expires))}</span>`)].join(" · ") || "<span style='color:var(--good)'>All certifications current</span>"}</div>` : ""}</div>
        ${role === "director" && s.role !== "director" ? `<button class="btn ghost sm" data-act="clubRemove" data-id="${esc(s.userId)}">Remove</button>` : ""}</div>`).join("")}</div>
      <form class="card" data-submit="clubMe"><h3>My details and certifications</h3>
        <input class="input" id="meName" placeholder="Name shown to families" value="${esc(me?.name || "")}"><input class="input" id="mePhone" placeholder="Phone" style="margin-top:8px" value="${esc(me?.phone || "")}">
        <div class="grid2" id="certRows">${Object.entries(CERT).map(([k, t]) => { const c = (me?.certs || []).find((x) => x.type === k); return `<label>${t}<input class="input" type="date" data-cert="${k}" value="${esc(c?.completed || "")}"></label>`; }).join("")}</div>
        <p class="disc">Enter the date you completed each one. We track renewals (SafeSport and concussion training yearly, CPR and background checks every 2 years).</p>
        ${role !== "coach" ? `<label class="check"><input type="checkbox" id="meOnCall" ${me?.onCall?.active ? "checked" : ""}><span>I'm on call at the fields now</span></label><input class="input" id="meWhere" placeholder="Where to find me, e.g. Field 3 medical tent" value="${esc(me?.onCall?.location || "")}">` : ""}
        <div class="actions"><button class="btn primary block">Save</button></div></form>`;
  },

  async fields(box) {
    const fields = club.fields || [];
    box.innerHTML = `
      <div class="card"><h3>Fields</h3>${fields.map((f) => `<div class="jrow"><div style="flex:1"><div class="rowtitle">${esc(f.name)} · ${esc(f.zip)}</div><div class="rowsub">${esc(f.status)}${f.note ? ` · ${esc(f.note)}` : ""}</div></div>
        <select class="input sm" data-change="clubFieldStatus" data-id="${f.id}">${["open", "delayed", "closed"].map((s) => `<option ${s === f.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>`).join("") || `<p class="sub">No fields yet.</p>`}
        <p class="disc">Closing or delaying a field posts an announcement to every club team and emails staff.</p></div>
      ${role === "director" ? `<form class="card" data-submit="clubField"><h3>Add a field</h3><div class="row2"><input class="input" id="fName" placeholder="Name, e.g. Riker Hill Park"><input class="input" id="fZip" inputmode="numeric" maxlength="5" placeholder="ZIP"></div>
        <div class="actions"><button class="btn ghost block">Add field</button></div><p class="disc">Each morning and early afternoon we check heat, storms and air quality at every field and alert staff.</p></form>` : ""}`;
  },

  async settings(box) {
    box.innerHTML = `
      <form class="card" data-submit="clubBrand"><h3>Branding</h3>
        <input class="input" id="bName" value="${esc(club.name)}" maxlength="80">
        <div class="row2" style="margin-top:8px"><label class="small">Main color<input class="input" type="color" id="bPrimary" value="${esc(club.primary || "#0b0e12")}"></label><label class="small">Accent<input class="input" type="color" id="bAccent" value="${esc(club.accent || "#bff63f")}"></label></div>
        <label class="btn ghost block filebtn" style="margin-top:8px">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" data-change="clubLogo" hidden></label>
        <div class="actions"><button class="btn primary block">Save branding</button></div>
        <p class="disc">Families on your teams see your logo and colors.</p></form>
      <form class="card" data-submit="clubSponsor"><h3>Sponsor</h3><p class="sub">A local business can sponsor your teams' meal guide. You choose it; no outside ads are ever shown.</p>
        <input class="input" id="spName" placeholder="Sponsor name" value="${esc(club.sponsor?.name || "")}"><input class="input" id="spUrl" placeholder="https://…" style="margin-top:8px" value="${esc(club.sponsor?.url || "")}">
        <input class="input" id="spMsg" placeholder="Short message (optional)" maxlength="140" style="margin-top:8px" value="${esc(club.sponsor?.message || "")}">
        <div class="actions"><button class="btn ghost block">Save sponsor</button></div></form>
      <div class="card"><h3>Plan</h3>
        <p class="sub">Clubs pay per player per season; families always use the app free.${club.freeMonths ? ` You have ${club.freeMonths} free month${club.freeMonths > 1 ? "s" : ""} from referrals.` : ""}</p>
        ${isNative() ? `<p class="sub">Manage your club plan on the website.</p>` : `<form data-submit="clubCheckout" class="row2"><input class="input" id="seats" type="number" min="1" max="5000" placeholder="Players" value="${club.seats || ""}"><button class="btn primary">${club.plan === "active" ? "Update plan" : "Subscribe"}</button></form>
        ${club.stripeCustomerId ? `<button class="btn ghost block" style="margin-top:8px" data-act="clubPortal">Billing and invoices</button>` : ""}`}
      </div>
      <div class="card"><h3>Refer a club</h3><p class="sub">Share your code. When another club starts with it, they get an extra free month and you get a free month.</p><div class="codebox">${esc(club.referralCode)}</div></div>
      <form class="card" data-submit="clubCamp"><h3>Post a camp or clinic</h3>
        <input class="input" id="cpTitle" placeholder="Title" maxlength="80"><div class="row2" style="margin-top:8px"><input class="input" id="cpStart" type="date"><input class="input" id="cpZip" placeholder="ZIP" maxlength="5"></div>
        <div class="row2" style="margin-top:8px"><input class="input" id="cpMin" type="number" placeholder="Min age"><input class="input" id="cpMax" type="number" placeholder="Max age"></div>
        <input class="input" id="cpUrl" placeholder="Sign-up link https://…" style="margin-top:8px">
        <div class="actions"><button class="btn ghost block">Post</button></div><p class="disc">Shown to players of the right age nearby.</p></form>`;
  },
};

let pendingLogo = null;
const reload = () => rerender();

export const actions = {
  clubTab(btn) { storeSet(`clubTab:${club.id}`, btn.dataset.k); location.hash = `#/club/${club.id}`; rerender(); },
  async clubCreate() {
    const r = await api("/api/clubs", { method: "POST", body: { name: $("#clubName").value, referral: $("#clubRef").value || undefined } });
    if (!r.ok) return toast(errText(r));
    location.hash = `#/club/${r.data.id}`;
  },
  async clubJoin() {
    const r = await api("/api/clubs/join", { method: "POST", body: { code: $("#staffCode").value, name: $("#staffName").value || undefined } });
    if (!r.ok) return toast(errText(r));
    toast(`Joined ${r.data.name}`); location.hash = `#/club/${r.data.clubId}`;
  },
  clubPrint: () => window.print(),
  async clubClear(btn) {
    if (!confirm("Record that you've cleared this player for full return to play?")) return;
    const r = await api(`/api/clubs/${club.id}/clear`, { method: "POST", body: { profileId: btn.dataset.id, date: todayStr() } });
    toast(r.ok ? "Cleared" : errText(r)); reload();
  },
  async clubTeam() {
    const r = await api(`/api/clubs/${club.id}/teams`, { method: "POST", body: { name: $("#ctName").value, ageGroup: $("#ctAge").value || undefined } });
    if (!r.ok) return toast(errText(r)); reload();
  },
  async clubInvite(btn) {
    const r = await api(`/api/clubs/${club.id}/invite`, { method: "POST", body: { role: btn.dataset.role } });
    if (!r.ok) return toast(errText(r));
    $("#invOut").innerHTML = `<div class="codebox">${esc(r.data.code)}</div><p class="sub">${esc(btn.textContent)}: works once, for 14 days. They enter it under More, then Club.</p>`;
  },
  async clubRemove(btn) { if (!confirm("Remove from staff?")) return; const r = await api(`/api/clubs/${club.id}/staff/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" }); toast(r.ok ? "Removed" : errText(r)); reload(); },
  async clubMe() {
    const certs = [...document.querySelectorAll("[data-cert]")].filter((i) => i.value).map((i) => ({ type: i.dataset.cert, completed: i.value }));
    const body = { name: $("#meName").value, phone: $("#mePhone").value, certs };
    if ($("#meOnCall")) body.onCall = { active: $("#meOnCall").checked, location: $("#meWhere").value || undefined };
    const r = await api(`/api/clubs/${club.id}/staff/me`, { method: "PUT", body });
    toast(r.ok ? "Saved" : errText(r)); if (r.ok) reload();
  },
  async clubField() {
    const r = await api(`/api/clubs/${club.id}/fields`, { method: "POST", body: { name: $("#fName").value, zip: $("#fZip").value } });
    if (!r.ok) return toast(errText(r)); reload();
  },
  async clubFieldStatus(sel) {
    const note = sel.value === "open" ? "" : prompt("Short note for families (optional)", "") || "";
    const r = await api(`/api/clubs/${club.id}/fields`, { method: "POST", body: { id: sel.dataset.id, status: sel.value, note } });
    toast(r.ok ? `Field ${sel.value}` : errText(r)); reload();
  },
  async clubLogo(input) {
    const f = input.files?.[0];
    if (!f) return;
    pendingLogo = await new Promise((res) => {
      const img = new Image();
      img.onload = () => { const s = Math.min(1, 256 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = img.width * s; c.height = img.height * s; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/png")); };
      img.src = URL.createObjectURL(f);
    });
    toast("Logo ready. Tap Save branding.");
  },
  async clubBrand() {
    const body = { name: $("#bName").value, primary: $("#bPrimary").value, accent: $("#bAccent").value };
    if (pendingLogo) body.logoUrl = pendingLogo;
    const r = await api(`/api/clubs/${club.id}`, { method: "PUT", body });
    toast(r.ok ? "Saved" : errText(r)); pendingLogo = null; reload();
  },
  async clubSponsor() {
    const name = $("#spName").value.trim();
    const r = await api(`/api/clubs/${club.id}`, { method: "PUT", body: { sponsor: name ? { name, url: $("#spUrl").value || undefined, message: $("#spMsg").value || undefined } : null } });
    toast(r.ok ? "Saved" : errText(r)); reload();
  },
  async clubCheckout() {
    const r = await api(`/api/clubs/${club.id}/billing/checkout`, { method: "POST", body: { seats: Number($("#seats").value) } });
    if (!r.ok) return toast(errText(r));
    location.href = r.data.url;
  },
  async clubPortal() { const r = await api(`/api/clubs/${club.id}/billing/portal`, { method: "POST" }); if (!r.ok) return toast(errText(r)); location.href = r.data.url; },
  async clubCamp() {
    const r = await api(`/api/clubs/${club.id}/camps`, { method: "POST", body: { title: $("#cpTitle").value, org: club.name, start: $("#cpStart").value, zip: $("#cpZip").value, ageMin: Number($("#cpMin").value), ageMax: Number($("#cpMax").value), url: $("#cpUrl").value || undefined } });
    toast(r.ok ? "Posted" : errText(r));
  },
};
