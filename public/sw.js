/* Service worker: makes the app installable and usable offline.
 *
 * - App shell (HTML, CSS, JS, icons): network first, cached copy when offline,
 *   so updates show up right away when online.
 * - API GETs: network first; when offline, the last saved answer is served
 *   (marked with x-offline: 1) so Today and Game Day still open at the field.
 * - Writes (POST/PUT/DELETE) are never cached.
 * - Logging out clears cached API answers.
 */
const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const API = `api-${VERSION}`;
const PRECACHE = [
  "/", "/index.html", "/css/app.css", "/js/app.js", "/js/ui.js", "/js/api.js", "/js/native.js",
  "/js/views/auth.js", "/js/views/profile.js", "/js/views/today.js", "/js/views/gameday.js", "/js/views/recovery.js",
  "/js/views/checkin.js", "/js/views/more.js", "/js/views/schedule.js", "/js/views/trends.js", "/js/views/grocery.js",
  "/js/views/team.js", "/js/views/settings.js", "/js/views/program.js", "/js/programs.js", "/js/weather.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
  "/privacy.html", "/terms.html",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "clear-api-cache") caches.delete(API);
});

async function networkFirst(req, cacheName, markOffline) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (!hit) {
      if (req.mode === "navigate") return (await caches.match("/index.html")) || Response.error();
      return new Response(JSON.stringify({ error: "offline", message: "You're offline and this hasn't been saved yet." }),
        { status: 503, headers: { "content-type": "application/json" } });
    }
    if (!markOffline) return hit;
    const h = new Headers(hit.headers); h.set("x-offline", "1");
    return new Response(await hit.blob(), { status: hit.status, headers: h });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/config") return; // always live
    e.respondWith(networkFirst(req, API, true));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(req, SHELL, false));
    return;
  }
  // Fonts and the auth library from CDNs: cache first.
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    e.respondWith(caches.open(SHELL).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { c.put(req, res.clone()); return res; })));
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow("/#/today"))));
});
