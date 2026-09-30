// Ask the app: questions answered with this player's food rules and schedule.

import { $, esc, todayStr, nowStr, storeGet, storeSet } from "../ui.js";
import { api, errText } from "../api.js";
import { active } from "../app.js";

const key = () => `ask:${active()?.id}`;
const SUGGEST = ["What should I eat before a 7 AM game?", "I have practice right after school. What's a good snack?", "What do I eat between two tournament games?", "How much water today?"];

function draw(el) {
  const hist = storeGet(key(), []);
  el.innerHTML = `
    <div class="chat" id="chat">${hist.length ? hist.map((m) => `<div class="bubble ${m.role}">${esc(m.content)}</div>`).join("") : `<p class="sub">Ask anything about food, drinks, sleep or recovery. Answers follow your food rules and age program.</p>
      <div class="chips">${SUGGEST.map((q) => `<button class="chip" data-act="askQuick">${esc(q)}</button>`).join("")}</div>`}</div>
    <form class="askbar" data-submit="askSend"><input class="input" id="askQ" placeholder="Ask a question" maxlength="600" autocomplete="off"><button class="btn primary">Ask</button></form>
    ${hist.length ? `<button class="btn link sm" data-act="askClear">Clear chat</button>` : ""}
    <p class="disc">General guidance, not medical advice. Always read labels.</p>`;
  const c = $("#chat"); c.scrollTop = c.scrollHeight;
}

export async function render(el) { draw(el); }

async function send(q) {
  q = q.trim();
  if (!q) return;
  const hist = storeGet(key(), []);
  const chat = $("#chat");
  chat.insertAdjacentHTML("beforeend", `<div class="bubble user">${esc(q)}</div><div class="bubble assistant dim" id="thinking">Thinking…</div>`);
  chat.scrollTop = chat.scrollHeight;
  const r = await api(`/api/profiles/${active().id}/ask`, { method: "POST", body: { question: q, history: hist.slice(-6), now: nowStr(), date: todayStr() } });
  const answer = r.ok ? r.data.answer : errText(r);
  if (r.ok) storeSet(key(), [...hist, { role: "user", content: q }, { role: "assistant", content: answer }].slice(-20));
  draw(document.getElementById("view"));
  if (!r.ok) $("#chat").insertAdjacentHTML("beforeend", `<div class="bubble assistant err">${esc(answer)}</div>`);
}

export const actions = {
  askSend() { const v = $("#askQ").value; $("#askQ").value = ""; return send(v); },
  askQuick(btn) { return send(btn.textContent); },
  askClear() { storeSet(key(), []); draw(document.getElementById("view")); },
};
