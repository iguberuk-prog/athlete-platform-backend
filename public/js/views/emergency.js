// Emergency card: big, simple, works offline once loaded. Add it to the lock screen in the iPhone app.

import { esc, todayStr, msg } from "../ui.js";
import { api, errText } from "../api.js";
import { isNative } from "../native.js";

export async function render(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/extras?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const c = r.data.emergency;
  el.innerHTML = `
    <div class="ecard printable">
      <div class="eh">EMERGENCY INFO</div>
      <div class="en">${esc(c.name)}${c.age !== null ? `, ${c.age}` : ""}</div>
      ${c.lines.length ? c.lines.map((l) => `<div class="el ${l.urgent ? "urgent" : ""}"><b>${esc(l.label)}:</b> ${esc(l.value)}</div>`).join("") : `<div class="el">No allergies or conditions on file.</div>`}
      ${c.contacts.length ? `<div class="eh" style="margin-top:12px">CALL</div>${c.contacts.map((x) => `<a class="ecall" href="tel:${esc(x.phone.replace(/[^\d+]/g, ""))}">${esc(x.label)}${x.name ? ` (${esc(x.name)})` : ""}: ${esc(x.phone)}</a>`).join("")}` : `<div class="warnbox">Add an emergency contact in Profile.</div>`}
      <div class="eh" style="margin-top:12px">IF SOMETHING HAPPENS</div>
      <ol class="hsteps">${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>
    <div class="actions noprint"><button class="btn primary" data-act="ePrint">Print wallet card</button><button class="btn ghost" data-act="nav" data-to="#/profile/edit">Edit details</button></div>
    <p class="disc noprint">${isNative() ? "Add the Emergency card widget to your lock screen: press and hold the lock screen, tap Customize, then add Athlete Performance." : "In the iPhone app you can put this on your lock screen as a widget."} Keep a printed copy in the sports bag.</p>`;
}
export const actions = { ePrint: () => window.print() };
