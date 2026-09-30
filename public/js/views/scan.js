// Scan: point the camera at a product barcode (or a QR code that carries one)
// and see if it's safe, and whether it's a good idea right now, before the
// next game or practice, during play, or after. Also: photo of a meal (13+).

import { $, esc, nowStr, todayStr, msg, toast, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { active } from "../app.js";

const V = { avoid: ["No", "bad"], caution: ["Careful", "warn"], ok: ["OK", "ok"], good: ["Good", "good"] };
const pill = (v) => `<span class="vpill ${V[v][1]}">${V[v][0]}</span>`;
const list = (items, cls = "") => `<ul class="list ${cls}">${items.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>`;

let stream = null, zx = null, busy = false, detector = null, raf = 0;

function stop() {
  cancelAnimationFrame(raf);
  try { zx?.reset(); } catch {}
  zx = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
window.addEventListener("hashchange", stop);

/** Barcode digits from a scan: plain UPC/EAN, or a GS1 Digital Link QR code. */
export function codeFrom(text) {
  const t = String(text || "").trim();
  if (/^\d{8,14}$/.test(t)) return t;
  const m = t.match(/\/01\/(\d{8,14})/) || t.match(/\b(\d{12,14})\b/);
  return m ? m[1] : null;
}

const historyKey = () => `scanHistory:${active()?.id}`;

export async function render(el, ctx) {
  stop();
  const p = ctx.profile;
  const photo = p.features?.snapPlate;
  const mode = ctx.sub === "photo" && photo ? "photo" : "scan";
  const hist = storeGet(historyKey(), []);
  el.innerHTML = `
    ${photo ? `<div class="seg"><button class="${mode === "scan" ? "on" : ""}" data-act="nav" data-to="#/scan">Scan a product</button><button class="${mode === "photo" ? "on" : ""}" data-act="nav" data-to="#/scan/photo">Photo of a meal</button></div>` : ""}
    ${mode === "scan" ? `
      <div class="card">
        <div class="scanbox"><video id="cam" playsinline muted></video><div class="aim"></div></div>
        <div class="actions"><button class="btn primary block" data-act="scanStart" id="startBtn">Start camera</button></div>
        <form data-submit="scanManual" class="row2" style="margin-top:10px">
          <input class="input" id="manual" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off">
          <button class="btn ghost">Check</button>
        </form>
      </div>
      <div id="result"></div>
      ${hist.length ? `<div class="card"><h3>Recent</h3><ul class="list">${hist.map((h) => `<li><button class="linkrow" data-act="scanAgain" data-code="${esc(h.code)}"><span style="flex:1">${esc(h.name)}</span>${pill(h.v)}</button></li>`).join("")}</ul></div>` : ""}
      <p class="disc">Product data comes from Open Food Facts, a free database built by volunteers. Labels change: always read the package, especially with allergies.</p>`
    : `
      <div class="card"><p class="sub">Take a photo of the whole plate. We'll list what's on it, rough carbs and protein, and anything to watch for.</p>
        <label class="btn primary block filebtn">Take or choose a photo<input type="file" accept="image/*" capture="environment" data-change="plateFile" hidden></label>
      </div><div id="result"></div>`}`;
}

function showProduct(a) {
  const hist = storeGet(historyKey(), []).filter((h) => h.code !== a.code);
  storeSet(historyKey(), [{ code: a.code, name: a.name, v: a.overall.verdict }, ...hist].slice(0, 10));
  $("#result").innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px;align-items:center">
        ${a.image ? `<img src="${esc(a.image)}" alt="" class="prodimg">` : ""}
        <div style="flex:1;min-width:0"><div class="rowtitle">${esc(a.name)}</div><div class="rowsub">${esc(a.brand || "")}</div></div>
        ${pill(a.overall.verdict)}
      </div>
      <p style="margin-top:10px"><b>${esc(a.overall.summary)}</b></p>
      ${a.safety.reasons.length ? `<div class="${a.safety.verdict === "avoid" ? "msg err" : "warnbox"}">${esc(a.safety.reasons.join(" "))}</div>` : ""}
    </div>
    <div class="card"><h3>When to eat it</h3>
      <div class="tgrid">${a.timing.map((t) => `<div class="tcell ${V[t.verdict][1]}"><div class="tlab">${esc(t.label)}</div>${pill(t.verdict)}<div class="rowsub">${esc(t.why)}</div></div>`).join("")}</div>
    </div>
    ${a.bad.length ? `<div class="card"><h3>What works against a soccer player</h3>${list(a.bad, "bad")}</div>` : ""}
    ${a.good.length ? `<div class="card"><h3>What's good</h3>${list(a.good)}</div>` : ""}
    <div class="card"><h3>Nutrition <span class="dim small">${esc(a.basis)}</span></h3>
      <table class="data"><tbody>${a.nutrition.map((n) => `<tr><td>${esc(n.label)}</td><td><b>${esc(n.value)}</b>${n.note ? ` <span class="dim">${esc(n.note)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
      ${a.ingredients ? `<details class="table"><summary>Ingredients</summary><p class="small">${esc(a.ingredients)}</p></details>` : ""}
    </div>
    <p class="disc">${esc(a.source)}</p>`;
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function lookup(raw) {
  const code = codeFrom(raw);
  if (!code) { toast("That code isn't a product barcode."); return; }
  if (busy) return;
  busy = true;
  $("#result").innerHTML = `<div class="card"><p class="muted">Checking ${esc(code)}…</p></div>`;
  const r = await api(`/api/profiles/${active().id}/scan/${code}?now=${encodeURIComponent(nowStr())}`);
  busy = false;
  if (!r.ok) { $("#result").innerHTML = msg(r.status === 404 ? "info" : "err", errText(r)); return; }
  navigator.vibrate?.(40);
  showProduct(r.data);
}

async function loadZxing() {
  if (window.ZXing) return window.ZXing;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  return window.ZXing;
}

export const actions = {
  async scanStart() {
    const video = $("#cam");
    const btn = $("#startBtn");
    if (stream || zx) { stop(); btn.textContent = "Start camera"; return; }
    try {
      if ("BarcodeDetector" in window) {
        detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream; await video.play();
        btn.textContent = "Stop camera";
        const tick = async () => {
          if (!stream) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.map((c) => codeFrom(c.rawValue)).find(Boolean);
            if (hit) { stop(); btn.textContent = "Scan another"; await lookup(hit); return; }
          } catch {}
          raf = requestAnimationFrame(() => setTimeout(tick, 150));
        };
        tick();
      } else {
        const Z = await loadZxing();
        zx = new Z.BrowserMultiFormatReader();
        btn.textContent = "Stop camera";
        await zx.decodeFromVideoDevice(undefined, video, (res) => {
          const hit = res && codeFrom(res.getText());
          if (hit) { stop(); btn.textContent = "Scan another"; lookup(hit); }
        });
      }
    } catch (e) {
      stop();
      btn.textContent = "Start camera";
      toast(/Permission|NotAllowed/i.test(String(e?.name || e)) ? "Camera blocked. Allow camera access in settings, or type the number." : "Camera not available. Type the barcode number instead.");
    }
  },
  scanManual() { lookup($("#manual").value); },
  scanAgain(btn) { lookup(btn.dataset.code); },
  async plateFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    $("#result").innerHTML = `<div class="card"><p class="muted">Looking at your plate…</p></div>`;
    const dataUrl = await shrink(file);
    const r = await api(`/api/profiles/${active().id}/plate`, { method: "POST", body: { image: dataUrl, date: todayStr() } });
    input.value = "";
    if (!r.ok) { $("#result").innerHTML = msg("err", errText(r)); return; }
    const d = r.data;
    $("#result").innerHTML = `
      ${d.flags.map((f) => `<div class="msg err" style="margin:0 0 10px">${esc(f)}</div>`).join("")}
      <div class="card"><h3>On the plate</h3><ul class="list">${d.items.map((i) => `<li><div style="flex:1"><div class="rowtitle">${esc(i.name)}</div><div class="rowsub">${esc(i.portion)}</div></div></li>`).join("") || "<li>We couldn't see food in that photo.</li>"}</ul>
        ${d.estimates.carbsG !== null ? `<p class="sub">About ${d.estimates.carbsG} g carbs, ${d.estimates.proteinG} g protein.</p>` : ""}</div>
      <div class="card"><h3>How it fits today</h3>${list(d.fit)}</div>
      <p class="disc">${esc(d.disclaimer)}</p>`;
  },
};

/** Resize to max 1280 px JPEG so uploads stay small. */
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
