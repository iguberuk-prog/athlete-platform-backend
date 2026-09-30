// Invite a friend: share sheet, text, email, copy link, QR code.
// Also the welcome page a friend sees when they open the invite link.

import { $, esc, msg, toast, storeGet, storeSet, todayStr } from "../ui.js";
import { api, errText } from "../api.js";

let data = null;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

async function qrSvg(text) {
  if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export async function render(el, ctx) {
  const name = storeGet("inviteName", "");
  const r = await api(`/api/invite?from=${encodeURIComponent(name)}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  data = r.data;
  el.innerHTML = `
    <section class="hero"><div class="greet">Invite friends and teammates</div><div class="headline">Free for families</div>
      <p class="sub" style="margin:6px 0 0">${data.joined ? `${data.joined} friend${data.joined === 1 ? " has" : "s have"} joined with your link.` : "Send your link by text or email. It opens on their phone with steps to get the app."}</p></section>
    <div class="card">
      <label class="f" for="invName">Your first name (shown in the invite)</label>
      <input class="input" id="invName" maxlength="40" value="${esc(name)}" placeholder="e.g. Igor" data-change="invName">
      <button class="btn primary block" data-act="invShare" style="margin-top:12px">Share invite</button>
      <div class="row2" style="margin-top:8px">
        <a class="btn ghost" id="invSms" href="#">Text a friend</a>
        <button class="btn ghost" data-act="invCopy">Copy link</button>
      </div>
      <div class="codebox" style="margin-top:12px">${esc(data.code)}</div>
    </div>
    <form class="card" data-submit="invEmail" novalidate><h3>Email an invite</h3>
      <input class="input" id="invTo" type="email" inputmode="email" autocomplete="off" placeholder="friend@email.com, another@email.com">
      <textarea class="input" id="invNote" maxlength="300" placeholder="Add a note (optional)" style="margin-top:8px"></textarea>
      <button class="btn primary block" style="margin-top:8px">Send email</button>
      ${data.emailReady ? "" : `<p class="disc">This opens your own email app with the invite ready to send.</p>`}
    </form>
    <div class="card center"><h3>Scan to get the app</h3><div id="invQr" class="qrbox" aria-label="QR code for your invite link"></div>
      <p class="rowsub">Show this at practice. Parents point their phone camera at it.</p>
      <button class="btn ghost sm" data-act="invQrSave">Save QR image</button></div>`;
  updateLinks();
  try { $("#invQr").innerHTML = await qrSvg(data.link); } catch { $("#invQr").innerHTML = `<p class="muted">QR code couldn't load. Use Copy link.</p>`; }
}

function currentText() {
  const n = ($("#invName")?.value || "").trim();
  const first = n.split(/\s+/)[0];
  const base = data.link.split("#")[0];
  const link = `${base}#/invite?code=${encodeURIComponent(data.code)}${first ? `&from=${encodeURIComponent(first)}` : ""}`;
  return { link, text: `${n || "A friend"} invited you to Athlete Performance: game-day fuel, recovery and sleep plans for soccer players, built around your age, allergies and schedule. Free for families. Get it here: ${link}` };
}

function updateLinks() {
  const { text } = currentText();
  const sms = $("#invSms");
  if (sms) sms.href = `sms:${isIOS() ? "&" : "?"}body=${encodeURIComponent(text)}`;
}

/** Welcome page for someone who opened an invite link (not signed in yet). */
export async function renderLanding(app, query) {
  const code = String(query.code || "").toUpperCase().slice(0, 12);
  const from = String(query.from || "").replace(/[<>]/g, "").slice(0, 30);
  storeSet("pendingInvite", code);
  const r = await api(`/api/invite/lookup?code=${encodeURIComponent(code)}`);
  const stores = r.ok ? r.data.stores : {};
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const store = isIOS() && stores.ios ? `<a class="btn primary block" href="${esc(stores.ios)}">Download on the App Store</a>`
    : isAndroid() && stores.android ? `<a class="btn primary block" href="${esc(stores.android)}">Get it on Google Play</a>` : "";
  const install = standalone ? "" : store || (isIOS()
    ? `<ol class="hsteps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button at the bottom.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
    : isAndroid() ? `<ol class="hsteps"><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>`
      : `<p class="sub" style="margin:0">Open this link on your phone to put the app on your home screen. Or keep going here on the computer.</p>`);
  app.innerHTML = `<div class="auth">
    <div class="brand"><div class="mark" aria-hidden="true">A</div><div><b>Athlete Performance</b><div class="muted small">Game-day fuel and recovery</div></div></div>
    <h1 class="big">${from ? `${esc(from)} invited you` : "You're invited"}</h1>
    <p class="sub">Game-day fuel, recovery and sleep plans for soccer players. Built around each player's age, allergies and team schedule. Free for families.</p>
    ${r.ok && !r.data.valid ? msg("info", "That invite code has expired, but you can still sign up.") : ""}
    ${install ? `<div class="card"><h3>1. Get the app on your phone</h3>${install}</div>` : ""}
    <div class="card"><h3>${install ? "2. " : ""}Create your free account</h3>
      <button class="btn primary block" data-act="nav" data-to="#/signup">Create an account</button>
      <button class="btn ghost block" data-act="nav" data-to="#/login" style="margin-top:8px">I already have an account</button></div>
  </div>`;
}

export const actions = {
  invName(input) { storeSet("inviteName", input.value.trim()); updateLinks(); },
  async invShare() {
    const { text, link } = currentText();
    if (navigator.share) { try { await navigator.share({ title: "Athlete Performance", text, url: link }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); toast("Invite copied. Paste it in a text or email."); } catch { toast(link, 6000); }
  },
  async invCopy() {
    const { link } = currentText();
    try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch { toast(link, 6000); }
  },
  async invEmail() {
    const to = $("#invTo").value.trim();
    if (!to) return toast("Add an email address.");
    const name = ($("#invName").value || "").trim(), note = $("#invNote").value.trim();
    if (!data.emailReady) {
      const { text } = currentText();
      location.href = `mailto:${encodeURIComponent(to).replace(/%2C/g, ",").replace(/%40/g, "@")}?subject=${encodeURIComponent(`${name || "A friend"} invited you to Athlete Performance`)}&body=${encodeURIComponent(text + (note ? `\n\n${note}` : ""))}`;
      return;
    }
    const r = await api("/api/invite/email", { method: "POST", body: { to, from: name, note, date: todayStr() } });
    if (!r.ok) return toast(errText(r));
    toast(`Invite sent to ${r.data.sent} ${r.data.sent === 1 ? "person" : "people"}`);
    $("#invTo").value = ""; $("#invNote").value = "";
  },
  invQrSave() {
    const svg = $("#invQr svg");
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 600;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 600); g.drawImage(img, 20, 20, 560, 560);
      const a = document.createElement("a"); a.download = "athlete-performance-invite.png"; a.href = c.toDataURL("image/png"); a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  },
};
