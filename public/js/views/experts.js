// Experts and camps: registered dietitians for one-on-one consults, and camps
// and clinics matched to the player's age, position and area.

import { $, esc, todayStr, niceDate, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active } from "../app.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  const st = ctx.query.state || "";
  const [d, c] = await Promise.all([api(`/api/dietitians${st ? `?state=${encodeURIComponent(st)}` : ""}`), p ? api(`/api/profiles/${p.id}/camps?date=${todayStr()}`) : Promise.resolve({ ok: true, data: { camps: [] } })]);
  if (!ctx.seq()) return;
  const dts = d.ok ? d.data.dietitians : [];
  const camps = c.ok ? c.data.camps : [];
  el.innerHTML = `
    <div class="sectionTitle">Registered dietitians</div>
    ${dts.map((x) => `<div class="card"><div class="rowtitle">${esc(x.name)}, ${esc(x.credentials)}</div>
      <div class="rowsub">${esc([x.specialties.join(", "), x.states.length ? `Licensed in ${x.states.join(", ")}` : "", x.rate ? `from $${x.rate}` : ""].filter(Boolean).join(" · "))}</div>
      ${x.bio ? `<p class="small">${esc(x.bio)}</p>` : ""}
      <details class="table"><summary>Request a video consult</summary>
        <form data-submit="dtRequest" data-id="${x.id}"><textarea class="input" name="msg" placeholder="What do you want help with? e.g. fueling for tournaments with a nut allergy"></textarea>
        <input class="input" name="times" placeholder="Good days and times" style="margin-top:8px"><div class="actions"><button class="btn primary block">Send request</button></div></form></details>
    </div>`).join("") || `<div class="card"><p class="sub">No dietitians listed${st ? ` in ${esc(st)}` : ""} yet.</p></div>`}
    <p class="disc">Dietitians are checked by a person before they're listed. The request shares your email and the player's first name, age and position. Share allergy and medical details yourself during the consult.</p>

    <div class="sectionTitle">Camps and clinics near you</div>
    ${camps.map((x) => `<div class="card"><div class="rowtitle">${esc(x.title)}${x.positionMatch && x.positions?.length ? ` <span class="pill ready"><span class="dot"></span>for your position</span>` : ""}</div>
      <div class="rowsub">${esc(x.org)} · ${esc(niceDate(x.start))}${x.end ? ` to ${esc(niceDate(x.end))}` : ""} · ages ${x.ageMin}-${x.ageMax}${x.distance !== null ? ` · ${x.distance} mi` : ""}${x.price ? ` · $${x.price}` : ""}</div>
      ${x.description ? `<p class="small">${esc(x.description)}</p>` : ""}${x.url ? `<a class="btn ghost sm" href="${esc(x.url)}" target="_blank" rel="noopener">Details and sign-up ›</a>` : ""}</div>`).join("") || `<div class="card"><p class="sub">No camps for this age nearby right now.</p></div>`}

    <details class="card"><summary><b>Are you a registered dietitian?</b></summary>
      <form data-submit="dtApply" style="margin-top:10px"><input class="input" id="daName" placeholder="Full name"><input class="input" id="daCred" placeholder="Credentials, e.g. MS, RDN, CSSD" style="margin-top:8px">
        <input class="input" id="daEmail" type="email" placeholder="Email for requests" style="margin-top:8px"><input class="input" id="daStates" placeholder="States licensed, e.g. NJ, NY" style="margin-top:8px">
        <input class="input" id="daSpec" placeholder="Specialties, e.g. youth athletes, food allergies" style="margin-top:8px"><input class="input" id="daUrl" placeholder="Booking link https://…" style="margin-top:8px">
        <textarea class="input" id="daBio" placeholder="Short bio" style="margin-top:8px"></textarea><div class="actions"><button class="btn ghost block">Apply to be listed</button></div></form></details>`;
}

export const actions = {
  async dtRequest(form) {
    const r = await api(`/api/dietitians/${form.dataset.id}/request`, { method: "POST", body: { profileId: active().id, message: form.msg.value, times: form.times.value } });
    if (!r.ok) return toast(errText(r));
    toast("Request sent. The dietitian will email you.");
    if (r.data.bookingUrl) window.open(r.data.bookingUrl, "_blank", "noopener");
  },
  async dtApply() {
    const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await api("/api/dietitians/apply", { method: "POST", body: { name: $("#daName").value, credentials: $("#daCred").value, email: $("#daEmail").value, states: split($("#daStates").value), specialties: split($("#daSpec").value), bookingUrl: $("#daUrl").value || undefined, bio: $("#daBio").value || undefined } });
    toast(r.ok ? "Thanks! We'll review your listing." : errText(r));
  },
};
void msg;
