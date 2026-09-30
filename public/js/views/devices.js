// Devices: connect Whoop, Oura (adults), Garmin (when approved), Apple Health (iPhone app).

import { esc, msg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender } from "../app.js";
import { isNative } from "../native.js";

export async function render(el, ctx) {
  const p = ctx.profile;
  const r = await api(`/api/profiles/${p.id}/integrations`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const q = ctx.query || {};
  const d = r.data;
  el.innerHTML = `
    ${q.connected ? msg("ok", `Connected. We pulled the last week of sleep and heart data.`) : ""}
    ${q.error ? msg("err", q.error === "expired" ? "That took too long. Try connecting again." : "Couldn't connect. Try again.") : ""}
    <div class="card"><h3>Apple Health</h3>
      ${d.appleHealth ? (isNative() ? `<p class="sub">Tap "Fill from Apple Health" on the check-in screen. Garmin, Oura and most watches can sync into Apple Health too.</p>` : `<p class="sub">Available in the iPhone app.</p>`) : `<p class="sub">Health data from devices is for players 13 and up.</p>`}
    </div>
    ${d.devices.map((x) => `
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3 style="margin:0">${esc(x.name)}</h3>${x.connected ? `<span class="pill ready">Connected</span>` : ""}</div>
        ${!x.allowed ? `<p class="sub">${esc(x.why || "Not available at this age.")}</p>`
          : !x.available ? `<p class="sub">${x.provider === "garmin" ? "Waiting on Garmin's approval. For now, sync Garmin Connect to Apple Health." : "Coming soon."}</p>`
          : x.connected ? `<p class="sub">${x.lastSyncAt ? `Last synced ${esc(new Date(x.lastSyncAt).toLocaleString())}.` : ""}${x.lastError ? ` Problem: ${esc(x.lastError)}` : ""}</p>
              <div class="actions"><button class="btn ghost" data-act="devSync" data-p="${x.provider}">Sync now</button><button class="btn ghost" data-act="devOff" data-p="${x.provider}">Disconnect</button></div>`
          : `<p class="sub">Sleep, resting heart rate and HRV fill into your check-ins. We never overwrite what you type.</p><button class="btn primary block" data-act="devOn" data-p="${x.provider}">Connect ${esc(x.name)}</button>`}
      </div>`).join("")}
    <p class="disc">Tokens are stored encrypted. Disconnect any time; we delete them right away.</p>`;
}

export const actions = {
  async devOn(btn) {
    const r = await api(`/api/profiles/${active().id}/integrations/${btn.dataset.p}/start`, { method: "POST" });
    if (!r.ok) return toast(errText(r));
    location.href = r.data.url;
  },
  async devSync(btn) {
    const r = await api(`/api/profiles/${active().id}/integrations/${btn.dataset.p}/sync`, { method: "POST" });
    toast(r.ok ? `Synced ${r.data.days} day(s)` : errText(r));
    rerender();
  },
  async devOff(btn) {
    const r = await api(`/api/profiles/${active().id}/integrations/${btn.dataset.p}`, { method: "DELETE" });
    toast(r.ok ? "Disconnected" : errText(r));
    rerender();
  },
};
