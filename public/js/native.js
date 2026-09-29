// Bridge to the iPhone app shell (Expo WebView). Everything here is a no-op in
// a normal browser, so the web app works the same on its own.
//
// Web -> native:  window.ReactNativeWebView.postMessage(JSON)
//   { type: "reminders", items: Reminder[], prefs }   schedule local notifications
//   { type: "health:request" }                          read sleep/HR from Apple Health
//   { type: "signout" }                                 clear scheduled notifications
// Native -> web:  window.__native({ type, ... })
//   { type: "ready", platform, version, health: bool }
//   { type: "health", sleepHours, restingHeartRate, hrvMs }

const listeners = {};
let info = { native: false };

export const isNative = () => !!window.ReactNativeWebView;
export const nativeInfo = () => info;

window.__native = (msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "ready") info = { native: true, ...msg };
  (listeners[msg.type] || []).forEach((fn) => fn(msg));
};

export function onNative(type, fn) { (listeners[type] ||= []).push(fn); }

export function post(msg) {
  if (!isNative()) return false;
  window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  return true;
}

/** Ask the phone for last night's sleep and heart data. Resolves null on the web or on timeout. */
export function requestHealth(timeoutMs = 5000) {
  if (!isNative()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    onNative("health", (m) => { if (!done) { done = true; clearTimeout(t); resolve(m); } });
    post({ type: "health:request" });
  });
}

// ---- browser fallback: show today's reminders while the app is open ----
const timers = [];
export function scheduleInBrowser(reminders) {
  timers.splice(0).forEach(clearTimeout);
  if (isNative() || !("Notification" in window) || Notification.permission !== "granted") return 0;
  let n = 0;
  for (const r of reminders) {
    const ms = new Date(r.at) - new Date();
    if (ms > 0 && ms < 12 * 3600 * 1000) {
      n++;
      timers.push(setTimeout(() => {
        navigator.serviceWorker?.getRegistration().then((reg) =>
          reg ? reg.showNotification(r.title, { body: r.body, tag: r.id, icon: "/icons/icon-192.png" })
              : new Notification(r.title, { body: r.body, tag: r.id }));
      }, ms));
    }
  }
  return n;
}
