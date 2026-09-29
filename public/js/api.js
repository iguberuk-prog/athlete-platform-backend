// Config, login (Supabase Auth or local dev login) and the API client.

let cfg = null;
let sb = null;
let dev = false;

const DEV_KEY = "devUser";
const DEV_ROLES = "devRoles";

export async function initAuth() {
  const res = await fetch("/api/config", { cache: "no-store" });
  cfg = await res.json();
  if (cfg.devAuth) { dev = true; return { ok: true, dev: true }; }
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return { ok: false };
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return { ok: true, dev: false };
}

const readJSON = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };

/** Current user { email, role } or null. */
export async function currentUser() {
  if (dev) return readJSON(DEV_KEY, null);
  const { data } = await sb.auth.getSession();
  const u = data?.session?.user;
  if (!u) return null;
  return { email: u.email || "", role: u.user_metadata?.role || "athlete" };
}

export async function signUp(email, password, role) {
  if (dev) {
    const roles = readJSON(DEV_ROLES, {}); roles[email] = role; localStorage.setItem(DEV_ROLES, JSON.stringify(roles));
    localStorage.setItem(DEV_KEY, JSON.stringify({ email, role }));
    return { ok: true, session: true };
  }
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { role } } });
  if (error) return { ok: false, error: error.message };
  return { ok: true, session: !!data.session };
}

export async function signIn(email, password) {
  if (dev) {
    const role = readJSON(DEV_ROLES, {})[email] || "athlete";
    localStorage.setItem(DEV_KEY, JSON.stringify({ email, role }));
    return { ok: true };
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut() {
  if (dev) { localStorage.removeItem(DEV_KEY); return; }
  try { await sb.auth.signOut(); } catch {}
}

export async function sendReset(email) {
  if (dev) return { ok: true };
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/?reset=1" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updatePassword(password) {
  if (dev) return { ok: true };
  const { error } = await sb.auth.updateUser({ password });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Calls back when the user arrives from a password-reset email. */
export function onPasswordRecovery(cb) {
  if (dev || !sb) return;
  sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") cb(); });
}

async function authHeaders() {
  if (dev) { const u = readJSON(DEV_KEY, null); return u ? { "x-dev-user": `${u.email}|${u.role}` } : {}; }
  try {
    const { data } = await sb.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { authorization: "Bearer " + t } : {};
  } catch { return {}; }
}

/** fetch wrapper: always resolves to { ok, status, data }. */
export async function api(path, { method = "GET", body } = {}) {
  const headers = { ...(await authHeaders()) };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
    return { ok: res.ok, status: res.status, data, offline: res.headers.get("x-offline") === "1" };
  } catch (e) {
    return { ok: false, status: 0, data: { message: "You look offline. Check your connection." } };
  }
}

export function errText(r) {
  const d = r.data || {};
  if (d.details) return d.details.map((x) => `${x.path}: ${x.message}`).join("\n");
  return d.message || d.error || `Something went wrong (${r.status}).`;
}
