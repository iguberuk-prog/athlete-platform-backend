// Shared UI helpers: DOM, escaping, dates, formatting, icons, toasts.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- dates (local wall clock, matching how events are stored) ----
const pad = (n) => String(n).padStart(2, "0");
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());
export const nowStr = () => { const d = new Date(); return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function addDays(date, n) { const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + n); return toDateStr(d); }
export function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }
export function to12(hm) {
  const [h0, m = "00"] = String(hm || "").split(":");
  let h = Number(h0) || 0; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
export function niceDate(date, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", opts);
}
export function relDay(date) {
  const d = daysBetween(todayStr(), date);
  if (d === 0) return "Today"; if (d === 1) return "Tomorrow"; if (d === -1) return "Yesterday";
  return niceDate(date);
}
export const minutesOf = (hm) => { const [h, m] = String(hm || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export function untilText(dateTime) {
  const ms = new Date(dateTime) - new Date();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000), m = Math.round((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${h} h ${m} min`;
  return `${m} min`;
}

// ---- display ----
export function initials(name) {
  const p = (name || "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}
export function avatar(profile, cls = "") {
  const url = profile?.identity?.avatarUrl;
  return `<span class="av ${cls}">${url ? `<img src="${esc(url)}" alt="">` : esc(initials(profile?.identity?.fullName))}</span>`;
}
export const kgToLb = (kg) => Math.round(kg / 0.453592);
export const lbToKg = (lb) => Math.round(lb * 0.453592 * 10) / 10;
export const gToOz = (g) => Math.round(g / 28.35 * 10) / 10;
export const title = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function toast(text, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function msg(kind, text) { return `<div class="msg ${kind}">${esc(text)}</div>`; }
export const loading = (text = "Loading…") => `<div class="empty"><div class="muted">${esc(text)}</div></div>`;

export function storeGet(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } }
export function storeSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ---- icons (stroke, 24px grid) ----
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M21 10.5l-5-.5M18 19l-3.5-4.5M6 19l3.5-4.5M3 10.5l5-.5"/>',
  recover: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  fork: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9"/>',
  watch: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 10v2l1.5 1"/>',
  family: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M2 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 8 0"/>',
  heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
