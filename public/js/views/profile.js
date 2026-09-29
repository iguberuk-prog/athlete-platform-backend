// Profile: 3-step onboarding for new athletes, and the full edit screen.

import { $, $$, esc, msg, avatar, kgToLb, lbToKg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { state, active, isParent, loadProfiles, setActive, go, render as rerender, syncReminders } from "../app.js";

export const SPORTS = {
  soccer: { label: "Soccer", code: "SOC", positions: [["goalkeeper", "Goalkeeper"], ["defender", "Defender"], ["fullback", "Fullback"], ["midfielder", "Midfielder"], ["winger", "Winger"], ["forward", "Forward"]] },
  basketball: { label: "Basketball", code: "BKB", positions: [["point_guard", "Point guard"], ["shooting_guard", "Shooting guard"], ["small_forward", "Small forward"], ["power_forward", "Power forward"], ["center", "Center"]] },
  american_football: { label: "Football", code: "AMF", positions: [["quarterback", "Quarterback"], ["running_back", "Running back"], ["wide_receiver", "Wide receiver"], ["tight_end", "Tight end"], ["offensive_line", "Offensive line"], ["defensive_line", "Defensive line"], ["linebacker", "Linebacker"], ["cornerback", "Cornerback"], ["safety", "Safety"], ["kicker", "Kicker"], ["punter", "Punter"]] },
  baseball: { label: "Baseball", code: "BSB", positions: [["pitcher", "Pitcher"], ["catcher", "Catcher"], ["infield", "Infield"], ["outfield", "Outfield"], ["designated_hitter", "Designated hitter"]] },
  track: { label: "Track & field", code: "TRK", positions: [["sprinter", "Sprinter"], ["middle_distance", "Middle distance"], ["long_distance", "Long distance"], ["hurdles", "Hurdles"], ["jumps", "Jumps"], ["throws", "Throws"], ["multi_event", "Multi-event"]] },
  cross_country: { label: "Cross country", code: "XC", positions: [["distance_runner", "Distance runner"]] },
  swimming: { label: "Swimming", code: "SWM", positions: [["freestyle", "Freestyle"], ["backstroke", "Backstroke"], ["breaststroke", "Breaststroke"], ["butterfly", "Butterfly"], ["individual_medley", "Individual medley"], ["distance", "Distance"], ["sprint", "Sprint"]] },
  volleyball: { label: "Volleyball", code: "VBL", positions: [["setter", "Setter"], ["outside_hitter", "Outside hitter"], ["opposite", "Opposite"], ["middle_blocker", "Middle blocker"], ["libero", "Libero"], ["defensive_specialist", "Defensive specialist"]] },
  lacrosse: { label: "Lacrosse", code: "LAX", positions: [["attack", "Attack"], ["midfield", "Midfield"], ["defense", "Defense"], ["goalie", "Goalie"], ["faceoff", "Face-off"]] },
  hockey: { label: "Hockey", code: "HKY", positions: [["goaltender", "Goaltender"], ["defenseman", "Defenseman"], ["center", "Center"], ["wing", "Wing"]] },
  tennis: { label: "Tennis", code: "TEN", positions: [["singles", "Singles"], ["doubles", "Doubles"]] },
  other: { label: "Other", code: "GEN", positions: [["general", "General"]] },
};

const ALLERGENS = [["peanut", "Peanut"], ["tree_nut", "Tree nut"], ["milk", "Milk"], ["egg", "Egg"], ["wheat", "Wheat"], ["gluten", "Gluten"], ["soy", "Soy"], ["fish", "Fish"], ["shellfish", "Shellfish"], ["sesame", "Sesame"]];
const DIETS = [["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["pescatarian", "Pescatarian"], ["halal", "Halal"], ["kosher", "Kosher"], ["dairy_free", "Dairy-free"], ["gluten_free", "Gluten-free"], ["nut_free", "Nut-free"]];
const INTOL = [["lactose", "Lactose"], ["gluten", "Gluten"], ["fructose", "Fructose"], ["caffeine", "Caffeine"]];

let pendingAvatar = null;
let step = 1;

const chipset = (name, opts, selected = []) =>
  `<div class="chips" id="${name}">${opts.map(([v, l]) =>
    `<label class="chip"><input type="checkbox" value="${v}" ${selected.includes(v) ? "checked" : ""}>${esc(l)}</label>`).join("")}</div>`;
const checked = (id) => $$(`#${id} input:checked`).map((c) => c.value);
const val = (id) => ($("#" + id)?.value ?? "").trim();

function randomCode(n = 5) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function fields(p) {
  const id = p?.identity || {}, sp = p?.sport || {}, an = p?.anthropometrics || {}, n = p?.nutrition || {};
  const rt = p?.routine || {}, tr = p?.training || {}, ct = p?.contact || {};
  const sport = sp.primarySport || "soccer";
  const inches = an.heightCm ? Math.round(an.heightCm / 2.54) : 69;
  const lb = an.bodyMassKg ? kgToLb(an.bodyMassKg) : "";
  const allergies = (n.allergies || []).map((a) => a.allergen);
  const severe = (n.allergies || []).filter((a) => a.severity === "severe").map((a) => a.allergen);

  const s1 = `
    <section data-step="1">
      <div class="photopick">
        <span id="avatarPreview">${avatar(p, "xl")}</span>
        <div>
          <input type="file" id="photoInput" accept="image/*" hidden>
          <button type="button" class="btn ghost sm" data-act="pickPhoto">${id.avatarUrl ? "Change photo" : "Add photo"}</button>
          <div class="hint">Optional. Cropped to a circle.</div>
        </div>
      </div>
      <label class="f" for="fullName">Full name</label>
      <input class="input" id="fullName" autocomplete="name" value="${esc(id.fullName || "")}" required>
      <div class="row2">
        <div><label class="f" for="sport">Sport</label>
          <select class="input" id="sport">${Object.entries(SPORTS).map(([k, v]) => `<option value="${k}" ${k === sport ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
        <div><label class="f" for="position">Position</label><select class="input" id="position"></select></div>
      </div>
      <div class="row2">
        <div><label class="f" for="dob">Date of birth</label><input class="input" id="dob" type="date" value="${esc(id.dateOfBirth || "")}"></div>
        <div><label class="f" for="sex">Sex</label><select class="input" id="sex">
          <option value="male" ${id.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${id.sex === "female" ? "selected" : ""}>Female</option></select></div>
      </div>
      <div class="row2">
        <div><label class="f" for="level">Level</label><select class="input" id="level">
          ${[["recreational", "Recreational / club"], ["high_school", "High school"], ["college", "College"], ["professional", "Professional"]].map(([v, l]) =>
            `<option value="${v}" ${(sp.competitionLevel || "high_school") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label class="f" for="jersey">Jersey # <span class="dim">(optional)</span></label><input class="input" id="jersey" inputmode="numeric" value="${id.jerseyNumber ?? ""}"></div>
      </div>
      <label class="f" for="club">Team or school <span class="dim">(optional)</span></label>
      <input class="input" id="club" value="${esc(id.clubTeam || id.school || "")}">
    </section>`;

  const s2 = `
    <section data-step="2">
      <div class="row2">
        <div><label class="f">Height</label>
          <div class="row2"><input class="input" id="heightFt" inputmode="numeric" aria-label="Feet" value="${Math.floor(inches / 12)}"><input class="input" id="heightIn" inputmode="numeric" aria-label="Inches" value="${inches % 12}"></div>
          <div class="hint">feet and inches</div></div>
        <div><label class="f" for="weight">Weight (lb)</label><input class="input" id="weight" inputmode="decimal" value="${lb}"><div class="hint">Plans scale to body weight</div></div>
      </div>
      <div class="row3">
        <div><label class="f" for="wake">Wake up</label><input class="input" id="wake" type="time" value="${rt.wakeTime || "07:00"}"></div>
        <div><label class="f" for="bed">Bedtime</label><input class="input" id="bed" type="time" value="${rt.bedTime || "22:30"}"></div>
        <div><label class="f" for="practice">Practice</label><input class="input" id="practice" type="time" value="${rt.usualPracticeTime || "17:00"}"></div>
      </div>
      <div class="hint">Your reminders are timed from these.</div>
      <div class="row2">
        <div><label class="f" for="days">Practices per week</label><input class="input" id="days" inputmode="numeric" value="${tr.trainingDaysPerWeek ?? 4}"></div>
        <div><label class="f" for="mins">Practice length (min)</label><input class="input" id="mins" inputmode="numeric" value="${tr.avgSessionMinutes ?? 90}"></div>
      </div>
    </section>`;

  const s3 = `
    <section data-step="3">
      <label class="f">Food allergies</label>
      ${chipset("allergies", ALLERGENS, allergies)}
      <label class="f">Any of those severe (EpiPen-level)?</label>
      ${chipset("severe", ALLERGENS, severe)}
      <div class="hint">We never suggest a food that contains an allergen you pick. Always double-check labels.</div>
      <label class="f">Diet</label>
      ${chipset("diets", DIETS, n.dietaryRestrictions || [])}
      <label class="f">Intolerances</label>
      ${chipset("intol", INTOL, n.intolerances || [])}
      <label class="f" for="dislikes">Foods you won't eat <span class="dim">(optional)</span></label>
      <input class="input" id="dislikes" placeholder="e.g. mushrooms, tuna" value="${esc((n.dislikes || []).join(", "))}">
      <h3 style="margin-top:22px">Parent and emergency contact</h3>
      <div class="row2">
        <div><label class="f" for="parEmail">Parent email</label><input class="input" id="parEmail" type="email" inputmode="email" value="${esc(ct.parentEmail || "")}"></div>
        <div><label class="f" for="parPhone">Parent phone</label><input class="input" id="parPhone" type="tel" value="${esc(ct.parentPhone || "")}"></div>
      </div>
      <div class="row2">
        <div><label class="f" for="emName">Emergency contact</label><input class="input" id="emName" value="${esc(ct.emergencyContact?.name || "")}"></div>
        <div><label class="f" for="emPhone">Their phone</label><input class="input" id="emPhone" type="tel" value="${esc(ct.emergencyContact?.phone || "")}"></div>
      </div>
    </section>`;
  return { s1, s2, s3 };
}

function fillPositions(selected) {
  const cfg = SPORTS[$("#sport").value] || SPORTS.other;
  $("#position").innerHTML = cfg.positions.map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("");
}

function showStep(n) {
  step = n;
  $$("section[data-step]").forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$(".steps i").forEach((b, i) => b.classList.toggle("on", i < n));
  $("#stepTitle").textContent = ["", "The basics", "Body and routine", "Food safety"][n];
  $("#stepNum").textContent = n;
  $("#prevBtn").hidden = n === 1;
  $("#nextBtn").textContent = n === 3 ? "Finish" : "Next";
  window.scrollTo(0, 0);
}

export async function render(el, ctx) {
  const isNew = ctx.sub === "new" || !ctx.profile;
  const p = isNew ? null : ctx.profile;
  pendingAvatar = null;
  const f = fields(p);

  if (isNew) {
    const first = !state.profiles.length;
    el.innerHTML = `
      <div class="steps" aria-hidden="true"><i class="on"></i><i></i><i></i></div>
      <form class="card" data-submit="saveProfile" novalidate>
        <div class="eyebrow">Step <span id="stepNum">1</span> of 3</div>
        <h2 id="stepTitle">The basics</h2>
        <p class="sub">${first ? (isParent() ? "Set up your first athlete. You can add more later." : "Two minutes, and your plan is ready.") : "Add another athlete to your account."}</p>
        ${f.s1}${f.s2}${f.s3}
        <div class="actions">
          <button type="button" class="btn ghost" id="prevBtn" data-act="profilePrev">Back</button>
          <button type="button" class="btn primary" id="nextBtn" data-act="profileNext">Next</button>
        </div>
        <div id="out"></div>
      </form>`;
    fillPositions();
    showStep(1);
  } else {
    el.innerHTML = `
      <form class="card" data-submit="saveProfile" novalidate>
        <h2>${esc(p.identity.fullName)}</h2>
        <p class="sub">Player ID ${esc(p.identity.playerCode || "")}</p>
        ${f.s1}<h3 style="margin-top:22px">Body and routine</h3>${f.s2}<h3 style="margin-top:22px">Food safety</h3>${f.s3}
        <div class="actions"><button class="btn primary block" type="submit">Save changes</button></div>
        <div id="out"></div>
      </form>
      <div class="card">
        <h3>Remove this athlete</h3>
        <p class="sub">Deletes this profile, its schedule and every check-in. This can't be undone.</p>
        <button class="btn danger block" data-act="deleteProfile">Delete ${esc(p.identity.fullName.split(" ")[0])}'s profile</button>
      </div>`;
    fillPositions(p.sport.positions?.[0]);
  }
  $("#sport").addEventListener("change", () => fillPositions());
  $("#photoInput").addEventListener("change", onPhoto);
}

function onPhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 320, c = document.createElement("canvas");
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      pendingAvatar = c.toDataURL("image/jpeg", 0.82);
      $("#avatarPreview").innerHTML = `<span class="av xl"><img src="${pendingAvatar}" alt=""></span>`;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function stepErrors(n) {
  if (n === 1) {
    if (!val("fullName")) return "Enter the athlete's name.";
    if (!val("dob")) return "Enter a date of birth.";
  }
  if (n === 2) {
    const lb = Number(val("weight"));
    if (!lb || lb < 45 || lb > 350) return "Enter weight in pounds (45-350).";
    const ft = Number(val("heightFt")), inch = Number(val("heightIn"));
    if (!(ft >= 3 && ft <= 7) || !(inch >= 0 && inch <= 11)) return "Enter height as feet (3-7) and inches (0-11).";
  }
  return null;
}

function payload(existing) {
  const sport = val("sport");
  const allergies = checked("allergies");
  const severe = checked("severe");
  for (const s of severe) if (!allergies.includes(s)) allergies.push(s);
  const emName = val("emName"), emPhone = val("emPhone");
  const contact = { ...(existing?.contact || {}) };
  contact.parentEmail = val("parEmail") || undefined;
  contact.parentPhone = val("parPhone") || undefined;
  contact.emergencyContact = emName && emPhone ? { name: emName, phone: emPhone } : undefined;

  const base = existing ? (({ id, ownerId, createdAt, updatedAt, ...rest }) => rest)(existing) : {};
  const jersey = val("jersey");
  return {
    ...base,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    identity: {
      ...(base.identity || {}),
      fullName: val("fullName"),
      dateOfBirth: val("dob") || undefined,
      sex: val("sex"),
      avatarUrl: pendingAvatar || base.identity?.avatarUrl || undefined,
      playerCode: base.identity?.playerCode || `${SPORTS[sport]?.code || "GEN"}-${randomCode()}`,
      jerseyNumber: jersey ? Number(jersey) : undefined,
      clubTeam: val("club") || undefined,
    },
    sport: { ...(base.sport || {}), primarySport: sport, positions: [val("position")], competitionLevel: val("level") },
    anthropometrics: {
      ...(base.anthropometrics || {}),
      heightCm: Math.round((Number(val("heightFt")) * 12 + Number(val("heightIn"))) * 2.54),
      bodyMassKg: lbToKg(Number(val("weight"))),
    },
    training: { ...(base.training || {}), trainingDaysPerWeek: Number(val("days")) || undefined, avgSessionMinutes: Number(val("mins")) || undefined },
    routine: { wakeTime: val("wake") || "07:00", bedTime: val("bed") || "22:30", usualPracticeTime: val("practice") || "17:00" },
    contact,
    nutrition: {
      ...(base.nutrition || {}),
      allergies: allergies.map((a) => ({ allergen: a, severity: severe.includes(a) ? "severe" : "moderate" })),
      dietaryRestrictions: checked("diets"),
      intolerances: checked("intol"),
      dislikes: val("dislikes").split(",").map((s) => s.trim()).filter(Boolean),
    },
    schedule: base.schedule || { events: [] },
  };
}

const out = (kind, text) => { $("#out").innerHTML = msg(kind, text); $("#out").scrollIntoView({ block: "nearest" }); };

export const actions = {
  pickPhoto: () => $("#photoInput").click(),
  profilePrev: () => showStep(Math.max(1, step - 1)),
  profileNext: async (el) => {
    const err = stepErrors(step);
    if (err) return out("err", err);
    $("#out").innerHTML = "";
    if (step < 3) { showStep(step + 1); return; }
    await actions.saveProfile(el.closest("form"));
  },

  async saveProfile(form) {
    if (state.route.sub === "new" && step < 3) return actions.profileNext(form.querySelector("#nextBtn"));
    const editing = !(state.route.sub === "new") && active();
    for (const n of [1, 2]) { const e = stepErrors(n); if (e) return out("err", e); }
    const body = payload(editing ? active() : null);
    const btn = form.querySelector(".btn.primary"); if (btn) btn.disabled = true;
    const r = editing
      ? await api(`/api/profiles/${active().id}`, { method: "PUT", body })
      : await api("/api/profiles", { method: "POST", body });
    if (btn) btn.disabled = false;
    if (!r.ok) return out("err", errText(r));
    await loadProfiles();
    setActive(r.data.id);
    toast(editing ? "Saved" : "You're all set");
    syncReminders();
    go(editing ? "#/more" : "#/today");
  },

  async deleteProfile() {
    const p = active();
    if (!p || !confirmDelete(p.identity.fullName)) return;
    const r = await api(`/api/profiles/${p.id}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    await loadProfiles();
    toast("Profile deleted");
    go("#/today");
    rerender();
  },
};

function confirmDelete(name) {
  // The app avoids blocking dialogs elsewhere; destructive actions are the exception.
  return window.confirm(`Delete ${name}'s profile and all of their data? This can't be undone.`);
}
