// Family: share a player's profile between parent and player accounts.

import { $, esc, msg, toast, niceDate } from "../ui.js";
import { api, errText } from "../api.js";
import { active, isParent, loadProfiles, render as rerender, setActive } from "../app.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = p ? await api(`/api/profiles/${p.id}/family`) : { ok: true, data: { links: [] } };
  if (!ctx.seq()) return;
  const links = r.ok ? r.data.links : [];
  const mine = p && !p.shared;
  el.innerHTML = `
    ${p ? `<div class="card"><h3>Who can see ${esc(p.identity.fullName.split(" ")[0])}'s plan</h3>
      ${links.length ? `<ul class="list">${links.map((l) => `<li><div style="flex:1"><div class="rowtitle">${esc(l.email || "Linked account")}</div><div class="rowsub">${l.role === "parent" ? "Parent" : "Player"} · since ${esc(niceDate(l.since.slice(0, 10)))}</div></div>
        ${mine ? `<button class="btn ghost sm" data-act="famRemove" data-u="${esc(l.userId)}">Remove</button>` : ""}</li>`).join("")}</ul>` : `<p class="sub">Only you right now.</p>`}
      ${mine ? `<div class="actions">
          <button class="btn primary" data-act="famInvite" data-role="${isParent() ? "athlete" : "parent"}">${isParent() ? "Let my player sign in on their phone" : "Link a parent"}</button>
        </div><div id="code"></div>
        <p class="disc">A linked account sees the plan, health screens and can log check-ins. Only you can edit or delete the profile.</p>`
      : `<button class="btn ghost" data-act="famLeave">Stop seeing this profile</button>`}
    </div>` : ""}
    <div class="card"><h3>Have a family code?</h3>
      <form data-submit="famRedeem" class="row2"><input class="input" id="famCode" placeholder="8-letter code" autocapitalize="characters" autocomplete="off" maxlength="9"><button class="btn primary">Link</button></form>
    </div>`;
}

export const actions = {
  async famInvite(btn) {
    const r = await api(`/api/profiles/${active().id}/family/invite`, { method: "POST", body: { role: btn.dataset.role } });
    if (!r.ok) return toast(errText(r));
    $("#code").innerHTML = `<div class="codebox">${esc(r.data.code)}</div><p class="sub">Give this code to ${btn.dataset.role === "parent" ? "your parent" : "your player"}. They enter it under More, then Family. Works once, for 7 days.</p>`;
  },
  async famRemove(btn) {
    const r = await api(`/api/profiles/${active().id}/family/${encodeURIComponent(btn.dataset.u)}`, { method: "DELETE" });
    toast(r.ok ? "Removed" : errText(r)); rerender();
  },
  async famLeave() {
    const links = await api(`/api/profiles/${active().id}/family`);
    // The server only lets you remove yourself here; it finds you from your login.
    const me = links.ok ? links.data.links.find((l) => l.self) : null;
    const r = await api(`/api/profiles/${active().id}/family/${encodeURIComponent(me?.userId || "me")}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    await loadProfiles(); location.hash = "#/today";
  },
  async famRedeem() {
    const r = await api("/api/family/redeem", { method: "POST", body: { code: $("#famCode").value } });
    if (!r.ok) return toast(errText(r));
    toast(`Linked to ${r.data.name}`);
    await loadProfiles(); setActive(r.data.profileId); location.hash = "#/today";
  },
};
