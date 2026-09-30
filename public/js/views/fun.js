// Fun: fuel buddy, sticker book and bedtime story (12 and under), pre-game
// playlist and season wrapped (13+), car quiz, family cook night and grocery hunt (everyone).
// Sub-screens: #/fun/quiz, #/fun/cook, #/fun/hunt, #/fun/wrapped.

import { $, $$, esc, todayStr, nowStr, msg, toast, icon, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { active, render as rerender, go } from "../app.js";

export const BUDDY_HEX = { lime: "#b6f23a", sky: "#5cc8ff", orange: "#ff9f43", purple: "#a77bff", red: "#ff6b6b", gold: "#ffd54a", teal: "#2ed3b7", pink: "#ff7ac6" };
const STICKER = { checkin: ["star", "#ffd54a"], water: ["drop", "#5cc8ff"], sleep: ["moon", "#a77bff"], warmup: ["flame", "#ff9f43"], chef: ["fork", "#2ed3b7"], quiz: ["brain", "#ff7ac6"], story: ["book", "#b6f23a"], breathe: ["wind", "#9ad"] };
const FACE = {
  super: `<path d="M34 58 q16 16 32 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  happy: `<path d="M36 60 q14 10 28 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  okay: `<path d="M38 62 h24" stroke="#111" stroke-width="4" stroke-linecap="round"/>`,
  waiting: `<circle cx="50" cy="62" r="5" fill="#111"/>`,
  thirsty: `<path d="M38 66 q12 -8 24 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M72 30 q4 8 0 12 q-4 -4 0 -12" fill="#5cc8ff"/>`,
  sleepy: `<path d="M38 64 q12 -6 24 0" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/><text x="70" y="26" font-size="14" font-weight="800" fill="#fff">z</text>`,
};

/** The buddy: a round soccer ball with a face, filled with the chosen color. */
export function buddySvg(b, size = 96) {
  const col = BUDDY_HEX[b.color] || BUDDY_HEX.lime;
  const eyes = b.mood === "sleepy"
    ? `<path d="M34 44 h10 M56 44 h10" stroke="#111" stroke-width="4" stroke-linecap="round"/>`
    : `<circle cx="39" cy="44" r="5" fill="#111"/><circle cx="61" cy="44" r="5" fill="#111"/>`;
  return `<svg class="buddy ${esc(b.mood)}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(b.name)} is ${esc(b.mood)}">
    <circle cx="50" cy="52" r="42" fill="${col}"/>
    <path d="M50 22 l12 9 -5 14 h-14 l-5 -14z" fill="rgba(0,0,0,.18)"/>
    <path d="M14 48 l10 -6 8 8 -4 12 -10 2z M86 48 l-10 -6 -8 8 4 12 10 2z" fill="rgba(0,0,0,.12)"/>
    ${eyes}${FACE[b.mood] || FACE.happy}</svg>`;
}

/** Small card for Today (kids only). */
export async function buddyCard(p) {
  if (!p.features?.fuelBuddy) return "";
  const r = await api(`/api/profiles/${p.id}/fun/kids?date=${todayStr()}&now=${encodeURIComponent(nowStr())}`);
  if (!r.ok) return "";
  const b = r.data.buddy;
  return `<button class="card buddyCard" data-act="nav" data-to="#/fun">${buddySvg(b, 64)}
    <div style="flex:1;min-width:0;text-align:left"><div class="rowtitle">${esc(b.name)}: ${esc(b.say)}</div>
      <div class="energy"><i style="width:${b.energy}%"></i></div>
      <div class="rowsub">${b.energy}% power · ${r.data.stickers.total} sticker${r.data.stickers.total === 1 ? "" : "s"}${r.data.story ? " · Story tonight!" : ""}</div></div></button>`;
}

const GENRE = { pop: "Pop", "hip-hop": "Hip-hop", latin: "Latin", edm: "EDM", rock: "Rock", country: "Country", afrobeats: "Afrobeats", "k-pop": "K-pop", "r-n-b": "R&B", indie: "Indie" };
const pid = () => active()?.id;

export async function render(el, ctx) {
  const sub = ctx.sub;
  if (sub === "quiz") return renderQuiz(el, ctx);
  if (sub === "cook") return renderCook(el, ctx);
  if (sub === "hunt") return renderHunt(el, ctx);
  if (sub === "wrapped") return renderWrapped(el, ctx);
  const p = ctx.profile, f = p.features || {};
  if (ctx.query.spotify === "connected") toast("Spotify connected");
  if (ctx.query.spotify === "error") toast("Spotify didn't connect. Try again.");
  const [k, pl] = await Promise.all([
    f.fuelBuddy || f.stickerBook || f.gameStory ? api(`/api/profiles/${p.id}/fun/kids?date=${todayStr()}&now=${encodeURIComponent(nowStr())}`) : null,
    f.playlist ? api(`/api/profiles/${p.id}/fun/playlist?now=${encodeURIComponent(nowStr())}`) : null,
  ]);
  if (!ctx.seq()) return;
  const parts = [];
  if (k && k.ok) {
    const { buddy: b, stickers: s, story, colors } = k.data;
    if (f.fuelBuddy) parts.push(`<div class="card buddyBig">
      <div style="display:flex;gap:14px;align-items:center">${buddySvg(b, 104)}
        <div style="flex:1"><div class="eyebrow">Your fuel buddy · level ${b.level}</div><h3 class="ftitle" style="margin:2px 0 6px">${esc(b.name)}</h3>
        <div class="say">${esc(b.say)}</div><div class="energy big"><i style="width:${b.energy}%"></i></div><div class="rowsub">${b.energy}% power today</div></div></div>
      <ul class="todo">${b.todo.map((t) => `<li class="${t.done ? "done" : ""}"><span class="box">${t.done ? "✓" : ""}</span>${esc(t.text)}</li>`).join("")}</ul>
      ${b.todo[0].done ? "" : `<button class="btn primary block" data-act="nav" data-to="#/checkin">Check in with ${esc(b.name)}</button>`}
      <details class="table" style="margin-top:10px"><summary>Change name or color</summary>
        <form data-submit="funBuddy" class="row2" style="margin-top:8px"><input class="input" id="buddyName" maxlength="20" value="${esc(b.name)}" aria-label="Buddy name"><button class="btn ghost">Save</button></form>
        <div class="swatches">${colors.map((c) => `<button class="swatch ${c === b.color ? "on" : ""} ${b.jerseys.includes(c) || c === b.color ? "" : "locked"}" style="background:${BUDDY_HEX[c]}" data-act="funColor" data-c="${c}" aria-label="${c}${b.jerseys.includes(c) ? "" : " (locked)"}">${b.jerseys.includes(c) || c === b.color ? "" : icon("lock")}</button>`).join("")}</div>
        <p class="rowsub">Fill a sticker page to unlock a new color.</p></details></div>`);
    if (f.gameStory && story) parts.push(`<div class="card story"><div class="eyebrow">Bedtime story</div><h3 class="ftitle">${esc(story.title)}</h3>
      ${story.paragraphs.map((x) => `<p>${esc(x)}</p>`).join("")}
      <button class="btn primary block" data-act="funLog" data-kind="story">We read it</button></div>`);
    if (f.stickerBook) {
      const page = s.pages[s.pages.length - 1] || [];
      parts.push(`<div class="card"><h3>Sticker book <span class="muted small">${s.total} total</span></h3>
        ${s.newToday.length ? `<div class="msg ok">New today: ${esc(s.newToday.map((x) => x.label).join(", "))}</div>` : ""}
        <div class="stickers">${Array.from({ length: s.perPage }, (_, i) => page[i]).map((st) => st
          ? `<div class="sticker" style="--c:${STICKER[st.kind]?.[1] || "#ccc"}" title="${esc(st.label)} · ${esc(st.date)}">${icon(STICKER[st.kind]?.[0] || "star")}<span>${esc(st.label)}</span></div>`
          : `<div class="sticker empty"></div>`).join("")}</div>
        <p class="rowsub">Check-ins, water, sleep, warm-ups, stories, quizzes and cooking all earn stickers. ${s.perPage - page.length === 0 ? "Page full! A new page starts tomorrow." : `${s.perPage - page.length} more to fill this page.`}</p></div>`);
    }
  }
  if (pl && pl.ok) {
    const x = pl.data;
    parts.push(`<div class="card"><h3>Pre-game playlist</h3><p class="sub">${esc(x.title)}. ${x.totalMinutes} minutes that go from calm to hype.</p>
      <div class="chips">${x.allGenres.map((g) => `<button class="chip ${x.genres.includes(g) ? "on" : ""}" data-act="funGenre" data-g="${g}">${esc(GENRE[g] || g)}</button>`).join("")}</div>
      <p class="rowsub">Pick up to 3.</p>
      <ol class="phases">${x.phases.map((ph, i) => `<li><div><b>${esc(ph.label)}</b> · ${ph.minutes} min</div><div class="rowsub">${esc(ph.mood)}, ${esc(ph.tempo)} tempo</div>
        <a class="btn link sm" href="${esc(x.links[i].url)}" target="_blank" rel="noopener">Open in Spotify ›</a></li>`).join("")}</ol>
      ${x.available ? (x.connected
        ? `<button class="btn primary block" data-act="funBuild">Build it in my Spotify</button><button class="btn link sm" data-act="funSpotifyOff">Disconnect Spotify</button>`
        : `<button class="btn primary block" data-act="funSpotify">Connect Spotify</button>`) : ""}
      ${x.explicitFilter ? `<p class="disc">Explicit songs are left out for players under 18.</p>` : ""}</div>`);
  }
  if (f.seasonWrapped) parts.push(`<button class="tile" data-act="nav" data-to="#/fun/wrapped"><span class="ic">${icon("trophy")}</span><span><div class="tt">Season wrapped</div><div class="ts">Your season in slides. Share it.</div></span><span class="chev">›</span></button>`);
  parts.push(`<div class="sectionTitle">With the family</div>
    <button class="tile" data-act="nav" data-to="#/fun/quiz"><span class="ic">${icon("brain")}</span><span><div class="tt">Car ride quiz</div><div class="ts">10 quick questions on the way to the field</div></span><span class="chev">›</span></button>
    <button class="tile" data-act="nav" data-to="#/fun/cook"><span class="ic">${icon("fork")}</span><span><div class="tt">Family cook night</div><div class="ts">One dinner, a job for everyone by age</div></span><span class="chev">›</span></button>
    <button class="tile" data-act="nav" data-to="#/fun/hunt"><span class="ic">${icon("cart")}</span><span><div class="tt">Grocery scavenger hunt</div><div class="ts">Turn this week's list into a game</div></span><span class="chev">›</span></button>`);
  el.innerHTML = parts.join("");
}

// ---- car quiz ----
let quiz = null;
async function renderQuiz(el, ctx) {
  if (!quiz || quiz.pid !== ctx.profile.id || ctx.query.new) {
    const seed = Math.floor(Math.random() * 1000);
    const r = await api(`/api/profiles/${ctx.profile.id}/fun/quiz?seed=${seed}`);
    if (!ctx.seq()) return;
    if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
    quiz = { pid: ctx.profile.id, qs: r.data.questions, i: 0, score: 0, picked: null, logged: false };
  }
  drawQuiz(el);
}
function drawQuiz(el = $("#view")) {
  const q = quiz.qs[quiz.i];
  if (!q) {
    const n = quiz.qs.length, s = quiz.score;
    el.innerHTML = `<div class="card center"><div class="eyebrow">Final score</div><div class="bignum">${s}/${n}</div>
      <p>${s >= 9 ? "Fuel genius!" : s >= 7 ? "Great job. Sticker earned!" : "Nice try. Play again on the way home!"}</p>
      <button class="btn primary block" data-act="nav" data-to="#/fun/quiz?new=1">Play again</button>
      <button class="btn ghost block" data-act="nav" data-to="#/fun">Done</button></div>`;
    if (!quiz.logged) { quiz.logged = true; api(`/api/profiles/${quiz.pid}/fun/log`, { method: "POST", body: { kind: "quiz", date: todayStr(), score: s } }).then((r) => { if (r.ok && r.data.sticker && active()?.features?.stickerBook) toast("Quiz whiz sticker!"); }); }
    return;
  }
  const answered = quiz.picked !== null;
  el.innerHTML = `<div class="card"><div class="eyebrow">Question ${quiz.i + 1} of ${quiz.qs.length} · score ${quiz.score}</div>
    <div class="qbar"><i style="width:${(quiz.i / quiz.qs.length) * 100}%"></i></div>
    <h3 class="q">${esc(q.q)}</h3>
    <div class="answers">${q.choices.map((c, i) => `<button class="ans ${answered ? (i === q.answer ? "right" : i === quiz.picked ? "wrong" : "") : ""}" data-act="quizPick" data-i="${i}" ${answered ? "disabled" : ""}>${esc(c)}</button>`).join("")}</div>
    ${answered ? `<div class="msg ${quiz.picked === q.answer ? "ok" : "info"}">${quiz.picked === q.answer ? "Yes! " : "Not quite. "}${esc(q.why)}</div>
      <button class="btn primary block" data-act="quizNext">${quiz.i + 1 === quiz.qs.length ? "See my score" : "Next question"}</button>` : `<p class="rowsub">A grown-up can read the question out loud.</p>`}</div>`;
}

// ---- cook night ----
let cookSeed = 0;
async function renderCook(el, ctx) {
  const r = await api(`/api/family/cook-night?seed=${cookSeed}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const n = r.data, rc = n.recipe;
  el.innerHTML = `<div class="card"><div class="eyebrow">Tonight's family dinner</div><h3 class="ftitle">${esc(rc.name)}</h3>
      <div class="rowsub">${rc.minutes} min · serves ${rc.serves} · safe for ${esc(n.players.map((x) => x.name).join(", "))}</div>
      <button class="btn ghost sm" data-act="cookAgain" style="margin-top:8px">Roll another dinner</button></div>
    <div class="card"><h3>Jobs</h3>${n.jobs.map((j) => `<div class="job"><div class="rowtitle">${esc(j.who)} <span class="pill neutral">${esc(j.title)}</span></div>
      <ul class="list">${j.jobs.map((x) => `<li><span class="bullet"></span><div>${esc(x)}</div></li>`).join("")}</ul></div>`).join("")}</div>
    <details class="card"><summary><b>Ingredients</b></summary><ul class="list">${rc.ingredients.map((i) => `<li><span class="bullet"></span><div>${esc(i.qty ? `${i.qty} ` : "")}${esc(i.name)}</div></li>`).join("")}</ul></details>
    <details class="card" open><summary><b>Steps</b></summary><ol class="hsteps">${rc.steps.map((s) => `<li>${s.who === "grown-up" ? `<span class="who">Grown-up</span> ` : ""}${esc(s.text)}</li>`).join("")}</ol></details>
    <div class="card"><ul class="list">${n.tips.map((t) => `<li><span class="bullet"></span><div>${esc(t)}</div></li>`).join("")}</ul>
      <button class="btn primary block" data-act="cookDone">We cooked it!</button></div>`;
}

// ---- grocery hunt ----
async function renderHunt(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/fun/hunt?from=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const key = `hunt:${ctx.profile.id}:${todayStr()}`;
  const found = new Set(storeGet(key, []));
  const h = r.data;
  const pts = () => h.stops.reduce((a, s) => a + s.items.reduce((b, i) => b + (found.has(i.name) ? i.points : 0), 0), 0);
  el.innerHTML = `<div class="card center"><div class="eyebrow">Points</div><div class="bignum" id="huntPts">${pts()}</div><div class="rowsub">of ${h.maxPoints}. Fruit and veggies are worth more.</div></div>
    ${h.stops.map((s) => `<div class="card"><h3>${esc(s.aisle)}</h3><p class="sub">${esc(s.clue)}</p>
      ${s.items.map((i) => `<label class="hunt"><input type="checkbox" data-change="huntTick" data-name="${esc(i.name)}" ${found.has(i.name) ? "checked" : ""}><span><b>${esc(i.name)}</b> <span class="muted">+${i.points}</span><div class="rowsub">${esc(i.hint)}</div></span></label>`).join("")}</div>`).join("")}
    <button class="btn ghost block" data-act="huntReset">Start over</button>`;
  el._hunt = { key, h };
}

// ---- season wrapped ----
async function renderWrapped(el, ctx) {
  const r = await api(`/api/profiles/${ctx.profile.id}/fun/wrapped?date=${todayStr()}`);
  if (!ctx.seq()) return;
  if (!r.ok) { el.innerHTML = msg("err", errText(r)); return; }
  const w = r.data;
  el.innerHTML = `<div class="wrapped" id="wrapped">${w.slides.map((s, i) => `<section class="wslide w${i % 5}"><div class="wbig">${esc(s.big)}</div>${s.small ? `<div class="wsmall">${esc(s.small)}</div>` : ""}<div class="wline">${esc(s.line)}</div></section>`).join("")}</div>
    <p class="rowsub center">Swipe through your season.</p>
    <button class="btn primary block" data-act="wrapShare" data-text="${esc(w.shareText)}">Share</button>`;
}

export const actions = {
  async funBuddy() {
    const r = await api(`/api/profiles/${pid()}/fun/settings`, { method: "PUT", body: { name: $("#buddyName").value } });
    if (!r.ok) return toast(errText(r)); toast("Saved"); rerender();
  },
  async funColor(btn) {
    if (btn.classList.contains("locked")) return toast("Fill a sticker page to unlock this color.");
    const r = await api(`/api/profiles/${pid()}/fun/settings`, { method: "PUT", body: { color: btn.dataset.c } });
    if (!r.ok) return toast(errText(r)); rerender();
  },
  async funLog(btn) {
    const r = await api(`/api/profiles/${pid()}/fun/log`, { method: "POST", body: { kind: btn.dataset.kind, date: todayStr() } });
    if (!r.ok) return toast(errText(r)); toast(r.data.sticker ? "Sticker earned. Sweet dreams!" : "Saved"); rerender();
  },
  async funGenre(btn) {
    const on = $$(".chip.on[data-g]").map((b) => b.dataset.g);
    const g = btn.dataset.g;
    const next = on.includes(g) ? on.filter((x) => x !== g) : [...on, g];
    if (next.length > 3) return toast("Pick up to 3.");
    const r = await api(`/api/profiles/${pid()}/fun/settings`, { method: "PUT", body: { genres: next } });
    if (!r.ok) return toast(errText(r)); rerender();
  },
  async funSpotify() {
    const r = await api(`/api/profiles/${pid()}/fun/spotify/start`, { method: "POST", body: {} });
    if (!r.ok) return toast(errText(r));
    location.href = r.data.url;
  },
  async funBuild(btn) {
    btn.disabled = true; btn.textContent = "Building…";
    const r = await api(`/api/profiles/${pid()}/fun/spotify/build`, { method: "POST", body: { now: nowStr() } });
    btn.disabled = false; btn.textContent = "Build it in my Spotify";
    if (!r.ok) return toast(errText(r));
    toast(`${r.data.tracks} songs added`);
    window.open(r.data.url, "_blank", "noopener");
  },
  async funSpotifyOff() { await api(`/api/profiles/${pid()}/fun/spotify`, { method: "DELETE" }); rerender(); },
  quizPick(btn) {
    const q = quiz.qs[quiz.i];
    quiz.picked = Number(btn.dataset.i);
    if (quiz.picked === q.answer) quiz.score++;
    drawQuiz();
  },
  quizNext() { quiz.i++; quiz.picked = null; drawQuiz(); window.scrollTo(0, 0); },
  cookAgain() { cookSeed++; rerender(); },
  async cookDone() {
    const r = await api(`/api/family/cook-night/done`, { method: "POST", body: { date: todayStr() } });
    if (!r.ok) return toast(errText(r)); toast("Chef hats for everyone!"); go("#/fun");
  },
  huntTick(box) {
    const { key, h } = $("#view")._hunt;
    const found = new Set(storeGet(key, []));
    if (box.checked) found.add(box.dataset.name); else found.delete(box.dataset.name);
    storeSet(key, [...found]);
    const pts = h.stops.reduce((a, s) => a + s.items.reduce((b, i) => b + (found.has(i.name) ? i.points : 0), 0), 0);
    $("#huntPts").textContent = pts;
    if (pts === h.maxPoints) toast("You found everything!");
  },
  huntReset() { storeSet($("#view")._hunt.key, []); rerender(); },
  async wrapShare(btn) {
    const text = btn.dataset.text;
    if (navigator.share) { try { await navigator.share({ title: "My season", text }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it anywhere."); } catch { toast(text, 5000); }
  },
};
