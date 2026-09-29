/**
 * Local dev server: serves public/ and routes /api/* to the Netlify function
 * handlers, using SQLite and the dev login. No Netlify CLI or Supabase needed.
 *
 *   npm run devserver        then open http://localhost:8888
 *
 * Never used in production.
 */

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

process.env.DB_BACKEND = "sqlite";
process.env.ALLOW_DEV_AUTH = "1";
process.env.SQLITE_PATH = process.env.SQLITE_PATH || "data/dev.db";
process.env.ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin";

const PORT = Number(process.env.PORT || 8888);
const ROOT = join(process.cwd(), "public");
const FN_DIR = join(process.cwd(), "netlify", "functions");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain",
};

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;
interface Route { re: RegExp; keys: string[]; handler: Handler }

async function loadRoutes(): Promise<Route[]> {
  const { mkdirSync } = await import("node:fs");
  mkdirSync("data", { recursive: true });
  const routes: Route[] = [];
  for (const f of await readdir(FN_DIR)) {
    if (!f.endsWith(".ts")) continue;
    const mod = await import(pathToFileURL(join(FN_DIR, f)).href);
    const paths: string[] = [].concat(mod.config?.path || []);
    for (const p of paths) {
      const keys: string[] = [];
      const re = new RegExp("^" + p.replace(/:([A-Za-z]+)/g, (_: string, k: string) => { keys.push(k); return "([^/]+)"; }) + "/?$");
      routes.push({ re, keys, handler: mod.default });
    }
  }
  // Most specific (most literal characters) first.
  return routes.sort((a, b) => b.re.source.replace(/\(\[\^\/\]\+\)/g, "").length - a.re.source.replace(/\(\[\^\/\]\+\)/g, "").length);
}

const routes = await loadRoutes();

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
        const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body });
        const out = await r.handler(request, { params });
        res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" }).end('{"error":"no_route"}');
      return;
    }
    let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const data = await readFile(file).catch(() => null);
    if (!data) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(data);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "text/plain" }).end(String(e));
  }
}).listen(PORT, () => console.log(`Dev server on http://localhost:${PORT} (SQLite, dev login)`));
