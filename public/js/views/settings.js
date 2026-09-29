// Settings: reminder preferences and account (password, delete account).

import { $, esc, msg, storeGet, storeSet, toast, to12, relDay, todayStr, nowStr } from "../ui.js";
import { api, errText, updatePassword } from "../api.js";
import { isNative } from "../native.js";
import { state, syncReminders, logOut, render as rerender } from "../app.js";

const KINDS = [
  ["checkin", "Morning check-in", "30 minutes after you wake up"],
  ["fuel", "Fueling", "Night-before dinner, pre-game meal, pre-practice snack"],
  ["hydrate", "Hydration", "Water checks on game and practice days"],
  ["recover", "Recovery", "Right after games and practices"],
  ["sleep", "Wind-down", "45 minutes before bedtime"],
];

export async function render(el, ctx) {
  return ctx.name === "reminders" ? reminders(el, ctx) : account(el);
}

async function reminders(el, ctx) {
  const prefs = storeGet("reminderPrefs", {});
  const p = ctx.profile;
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const how = isNative()
    ? `<div class="msg info">Reminders arrive as iPhone notifications, even when the app is closed.</div>`
    : perm === "granted"
      ? `<div class="msg info">In the browser, reminders pop up while the app is open. The iPhone app sends them even when it's closed.</div>`
      : perm === "unsupported"
        ? `<div class="msg info">This browser can't show notifications. Your reminders still show on the Today screen.</div>`
        : `<div class="msg info">Allow notifications to get reminders while the app is open.<div class="actions"><button class="btn primary sm" data-act="askNotify">Allow notifications</button></div></div>`;

  let upcoming = "";
  if (p) {
    const r = await api(`/api/profiles/${p.id}/reminders?from=${todayStr()}&days=3&now=${encodeURIComponent(nowStr())}${Object.entries(prefs).filter(([, v]) => v === false).map(([k]) => k).join(",") ? "&off=" + Object.entries(prefs).filter(([, v]) => v === false).map(([k]) => k).join(",") : ""}`);
    if (!ctx.seq()) return;
    const items = r.ok ? r.data.reminders.slice(0, 12) : [];
    upcoming = `<div class="card"><h3>Coming up</h3>${items.length ? `<ul class="list">${items.map((x) => `<li><span class="time">${esc(to12(x.at.slice(11)))}</span><div><div class="rowtitle">${esc(x.title)} <span class="kind ${x.kind}">${esc(x.kind)}</span></div><div class="rowsub">${esc(relDay(x.at.slice(0, 10)))}: ${esc(x.body)}</div></div></li>`).join("")}</ul>` : `<p class="muted" style="margin:0">Nothing in the next 3 days.</p>`}</div>`;
  }

  el.innerHTML = `
    ${how}
    <div class="card" style="margin-top:14px">
      <h3>Send me</h3>
      ${KINDS.map(([k, a, b]) => `<div class="switch"><div><div class="rowtitle">${a}</div><div class="rowsub">${b}</div></div>
        <label class="toggle"><input type="checkbox" data-act="toggleKind" data-k="${k}" ${prefs[k] === false ? "" : "checked"} aria-label="${a}"><span></span></label></div>`).join("")}
      <p class="hint">Times come from the wake-up, bedtime and practice times in your profile.</p>
    </div>
    ${upcoming}`;
}

function account(el) {
  const u = state.user || {};
  el.innerHTML = `
    <div class="card">
      <h3>Signed in</h3>
      <div class="rowtitle">${esc(u.email)}</div>
      <div class="rowsub">${esc({ athlete: "Athlete account", parent: "Parent account", coach: "Coach account" }[u.role] || "")}</div>
    </div>
    <form class="card" data-submit="changePassword" novalidate>
      <h3>Change password</h3>
      <label class="f" for="np">New password</label><input class="input" id="np" type="password" autocomplete="new-password" minlength="8">
      <label class="f" for="np2">Confirm</label><input class="input" id="np2" type="password" autocomplete="new-password" minlength="8">
      <div class="actions"><button class="btn primary block" type="submit">Update password</button></div>
      <div id="pwOut"></div>
    </form>
    <div class="card">
      <h3>Your data</h3>
      <p class="sub">Everything you enter is stored securely and never sold or shared with advertisers. See the <a href="/privacy.html">Privacy Policy</a>.</p>
      <button class="btn ghost block" data-act="exportData">Download my data</button>
    </div>
    <div class="card">
      <h3>Delete account</h3>
      <p class="sub">Permanently deletes your login, every athlete profile on this account, all check-ins, schedules and team memberships. This can't be undone.</p>
      <label class="f" for="delConfirm">Type DELETE to confirm</label>
      <input class="input" id="delConfirm" autocomplete="off" autocapitalize="characters">
      <div class="actions"><button class="btn danger block" data-act="deleteAccount">Delete my account</button></div>
      <div id="delOut"></div>
    </div>`;
}

export const actions = {
  toggleKind(input) {
    setTimeout(() => {
      const prefs = storeGet("reminderPrefs", {});
      prefs[input.dataset.k] = input.checked;
      storeSet("reminderPrefs", prefs);
      syncReminders();
      toast(input.checked ? "On" : "Off", 1200);
    });
  },
  async askNotify() {
    const res = await Notification.requestPermission();
    toast(res === "granted" ? "Notifications on" : "Notifications stay off");
    syncReminders();
    rerender();
  },
  async changePassword() {
    const a = $("#np").value, b = $("#np2").value;
    if (a.length < 8) return ($("#pwOut").innerHTML = msg("err", "Use at least 8 characters."));
    if (a !== b) return ($("#pwOut").innerHTML = msg("err", "The passwords don't match."));
    const r = await updatePassword(a);
    $("#pwOut").innerHTML = r.ok ? msg("ok", "Password updated.") : msg("err", r.error);
    if (r.ok) { $("#np").value = ""; $("#np2").value = ""; }
  },
  async exportData() {
    const profiles = state.profiles;
    const out = { exportedAt: new Date().toISOString(), account: state.user, profiles: [] };
    for (const p of profiles) {
      const c = await api(`/api/profiles/${p.id}/checkins?limit=365`);
      out.profiles.push({ profile: p, checkins: c.ok ? c.data.checkins : [] });
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `my-athlete-data-${todayStr()}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async deleteAccount(btn) {
    if ($("#delConfirm").value.trim().toUpperCase() !== "DELETE") {
      $("#delOut").innerHTML = msg("err", "Type DELETE in the box to confirm.");
      return;
    }
    btn.disabled = true;
    const r = await api("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
    btn.disabled = false;
    if (!r.ok) { $("#delOut").innerHTML = msg("err", errText(r)); return; }
    try { localStorage.clear(); } catch {}
    await logOut();
    toast("Your account and data were deleted.", 4000);
  },
};

