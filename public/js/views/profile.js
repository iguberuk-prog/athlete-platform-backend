// Profile: 4-step onboarding (food safety first), and the full edit screen.

import { $, $$, esc, msg, avatar, kgToLb, lbToKg, toast } from "../ui.js";
import { api, errText } from "../api.js";
import { state, active, isParent, loadProfiles, setActive, go, render as rerender, syncReminders } from "../app.js";
import { ageFromDob, programFor } from "../programs.js";

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
// ---------------------------------------------------------------------------
// Food-safety interview options
// ---------------------------------------------------------------------------
const ALLERGENS = [["peanut", "Peanut"], ["tree_nut", "Tree nuts"], ["milk", "Milk / dairy"], ["egg", "Egg"], ["wheat", "Wheat"], ["gluten", "Gluten"], ["soy", "Soy"], ["fish", "Fish"], ["shellfish", "Shellfish"], ["sesame", "Sesame"]];
const MEDICAL = [["celiac", "Celiac disease"], ["type1_diabetes", "Type 1 diabetes"], ["sensitive_stomach", "Sensitive stomach before games"], ["low_fodmap", "IBS / low-FODMAP"]];
const DIETS = [["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["pescatarian", "Pescatarian"], ["halal", "Halal"], ["kosher", "Kosher"], ["no_pork", "No pork"], ["no_red_meat", "No red meat"], ["dairy_free", "Dairy-free"], ["gluten_free", "Gluten-free"], ["nut_free", "Nut-free"]];
const INTOL = [["lactose", "Lactose"], ["gluten", "Gluten sensitivity"], ["fructose", "Fructose"], ["caffeine", "Caffeine"]];
const LABEL = Object.fromEntries([...ALLERGENS, ...MEDICAL, ...DIETS, ...INTOL.map(([k, v]) => ["i:" + k, v])]);
const STEP_TITLES = ["", "Food safety", "About the athlete", "Body and routine", "Review and confirm"];
const STEPS = 4;

let pendingAvatar = null;
let step = 1;
let isNew = true;
/** Allergy interview state: answer + per-allergen detail. Keys: allergen id, or "other:<name>". */
let fs = { answer: null, detail: {} };

const chipset = (name, opts, selected = [], act = "") =>
  `<div class="chips" id="${name}">${opts.map(([v, l]) =>
    `<label class="chip"><input type="checkbox" value="${v}" ${selected.includes(v) ? "checked" : ""} ${act ? `data-act="${act}"` : ""}>${esc(l)}</label>`).join("")}</div>`;
const checked = (id) => $$(`#${id} input:checked`).map((c) => c.value);
const val = (id) => ($("#" + id)?.value ?? "").trim();
const who = () => (isParent() ? "your athlete" : "you");
const whoCap = () => (isParent() ? "Your athlete" : "You");

function randomCode(n = 5) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function otherNames() {
  return val("otherAllergy").split(",").map((s) => s.trim()).filter(Boolean);
}
function allergyKeys() {
  return [...checked("allergies"), ...otherNames().map((n) => "other:" + n.toLowerCase())];
}
function detailFor(key) {
  return (fs.detail[key] ||= { severity: "moderate", anaphylaxis: false, epinephrine: false, cross: false });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function foodSection(p) {
  const n = p?.nutrition || {};
  const listed = (n.allergies || []).filter((a) => a.allergen !== "other").map((a) => a.allergen);
  const others = (n.allergies || []).filter((a) => a.allergen === "other").map((a) => a.note).filter(Boolean);
  return `
    <section data-step="1" id="food">
      <div class="qblock">
        <div class="q">${isParent() ? "Does your athlete have any food allergies?" : "Do you have any food allergies?"}</div>
        <div class="seg" id="hasAllergy">
          <button type="button" data-act="allergyAnswer" data-v="no" class="${fs.answer === "no" ? "on" : ""}">No allergies</button>
          <button type="button" data-act="allergyAnswer" data-v="yes" class="${fs.answer === "yes" ? "on" : ""}">Yes</button>
        </div>
        <div id="allergyBox" ${fs.answer === "yes" ? "" : "hidden"}>
          <label class="f">Which ones? Pick all that apply.</label>
          ${chipset("allergies", ALLERGENS, listed, "allergyPick")}
          <label class="f" for="otherAllergy">Anything else? <span class="dim">(comma-separated, e.g. kiwi, mustard)</span></label>
          <input class="input" id="otherAllergy" value="${esc(others.join(", "))}" autocomplete="off">
          <div id="allergyDetails"></div>
        </div>
      </div>

      <div class="qblock">
        <div class="q">Any medical diet?</div>
        <p class="hint" style="margin-top:0">Private. Only used to filter food. Coaches never see this, except celiac shown as "gluten (strict)".</p>
        ${chipset("medical", MEDICAL, n.medicalDiets || [])}
      </div>

      <div class="qblock">
        <div class="q">Religious or lifestyle diet?</div>
        ${chipset("diets", DIETS, n.dietaryRestrictions || [])}
      </div>

      <div class="qblock">
        <div class="q">Any intolerances?</div>
        <p class="hint" style="margin-top:0">Foods that cause discomfort but aren't allergies.</p>
        ${chipset("intol", INTOL, n.intolerances || [])}
      </div>

      <div class="qblock">
        <div class="q">Foods ${who()} won't eat?</div>
        <input class="input" id="dislikes" placeholder="e.g. fish, eggs, mushrooms" value="${esc((n.dislikes || []).join(", "))}">
        <div class="hint">We leave these out of every plan and grocery list.</div>
      </div>
    </section>`;
}

function aboutSection(p) {
  const id = p?.identity || {}, sp = p?.sport || {};
  const sport = sp.primarySport || "soccer";
  return `
    <section data-step="2">
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
        <div><label class="f" for="dob">Date of birth</label><input class="input" id="dob" type="date" value="${esc(id.dateOfBirth || "")}"></div>
        <div><label class="f" for="sex">Sex</label><select class="input" id="sex">
          <option value="male" ${id.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${id.sex === "female" ? "selected" : ""}>Female</option></select></div>
      </div>
      <div id="programPreview"></div>
      <div class="row2">
        <div><label class="f" for="sport">Sport</label>
          <select class="input" id="sport">${Object.entries(SPORTS).map(([k, v]) => `<option value="${k}" ${k === sport ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
        <div><label class="f" for="position">Position</label><select class="input" id="position"></select></div>
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
}

function bodySection(p) {
  const an = p?.anthropometrics || {}, rt = p?.routine || {}, tr = p?.training || {};
  const inches = an.heightCm ? Math.round(an.heightCm / 2.54) : 66;
  return `
    <section data-step="3">
      <div class="row2">
        <div><label class="f">Height</label>
          <div class="row2"><input class="input" id="heightFt" inputmode="numeric" aria-label="Feet" value="${Math.floor(inches / 12)}"><input class="input" id="heightIn" inputmode="numeric" aria-label="Inches" value="${inches % 12}"></div>
          <div class="hint">feet and inches</div></div>
        <div><label class="f" for="weight">Weight (lb)</label><input class="input" id="weight" inputmode="decimal" value="${an.bodyMassKg ? kgToLb(an.bodyMassKg) : ""}"><div class="hint">Plans scale to body weight</div></div>
      </div>
      <div class="row3">
        <div><label class="f" for="wake">Wake up</label><input class="input" id="wake" type="time" value="${rt.wakeTime || "07:00"}"></div>
        <div><label class="f" for="bed">Bedtime</label><input class="input" id="bed" type="time" value="${rt.bedTime || "22:00"}"></div>
        <div><label class="f" for="practice">Practice</label><input class="input" id="practice" type="time" value="${rt.usualPracticeTime || "17:00"}"></div>
      </div>
      <div class="hint">Reminders and sleep targets are timed from these.</div>
      <label class="f" for="homeZip">Home ZIP code <span class="dim">(where ${who()} usually train${isParent() ? "s" : ""})</span></label>
      <input class="input" id="homeZip" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="e.g. 07039" value="${esc(rt.homeZip || "")}">
      <div class="hint" id="zipPlace">We check the forecast so plans adjust for heat and cold.</div>
      <div class="row2">
        <div><label class="f" for="days">Practices per week</label><input class="input" id="days" inputmode="numeric" value="${tr.trainingDaysPerWeek ?? 3}"></div>
        <div><label class="f" for="mins">Practice length (min)</label><input class="input" id="mins" inputmode="numeric" value="${tr.avgSessionMinutes ?? 75}"></div>
      </div>
    </section>`;
}

function reviewSection(p) {
  const ct = p?.contact || {};
  return `
    <section data-step="4">
      <div id="reviewBox"></div>
      <h3 style="margin-top:20px">Parent and emergency contact</h3>
      <div class="row2">
        <div><label class="f" for="parEmail">Parent email</label><input class="input" id="parEmail" type="email" inputmode="email" value="${esc(ct.parentEmail || "")}"></div>
        <div><label class="f" for="parPhone">Parent phone</label><input class="input" id="parPhone" type="tel" value="${esc(ct.parentPhone || "")}"></div>
      </div>
      <div class="row2">
        <div><label class="f" for="emName">Emergency contact</label><input class="input" id="emName" value="${esc(ct.emergencyContact?.name || "")}"></div>
        <div><label class="f" for="emPhone">Their phone</label><input class="input" id="emPhone" type="tel" value="${esc(ct.emergencyContact?.phone || "")}"></div>
      </div>
      <label class="check confirm"><input type="checkbox" id="confirmSafety"><span><b>This food-safety information is complete and correct.</b> ${whoCap()} will only see foods that fit it. I'll update it if anything changes.</span></label>
    </section>`;
}

// ---------------------------------------------------------------------------
// Dynamic pieces
// ---------------------------------------------------------------------------
function renderAllergyDetails() {
  const box = $("#allergyDetails");
  if (!box) return;
  const keys = allergyKeys();
  box.innerHTML = keys.length ? `<label class="f">Tell us about each one</label>` + keys.map((k) => {
    const d = detailFor(k);
    const name = k.startsWith("other:") ? k.slice(6) : LABEL[k] || k;
    return `<div class="allergyRow" data-key="${esc(k)}">
      <div class="rowtitle">${esc(name)}</div>
      <div class="seg sevseg" role="radiogroup" aria-label="How severe">${["mild", "moderate", "severe"].map((s) =>
        `<button type="button" data-act="allergySev" data-key="${esc(k)}" data-v="${s}" class="${d.severity === s ? "on" : ""}">${s === "severe" ? "Severe" : s === "mild" ? "Mild" : "Moderate"}</button>`).join("")}</div>
      <label class="check"><input type="checkbox" data-act="allergyFlag" data-key="${esc(k)}" data-f="anaphylaxis" ${d.anaphylaxis ? "checked" : ""}><span>Has had anaphylaxis (trouble breathing, swelling, needed emergency care)</span></label>
      <label class="check"><input type="checkbox" data-act="allergyFlag" data-key="${esc(k)}" data-f="epinephrine" ${d.epinephrine ? "checked" : ""}><span>Carries an EpiPen or other epinephrine auto-injector</span></label>
      <label class="check"><input type="checkbox" data-act="allergyFlag" data-key="${esc(k)}" data-f="cross" ${d.cross || d.severity === "severe" ? "checked" : ""}><span>Also avoid "may contain" and shared-equipment foods</span></label>
    </div>`;
  }).join("") : "";
}

function renderProgramPreview() {
  const el = $("#programPreview");
  if (!el) return;
  const age = ageFromDob(val("dob"));
  const prog = programFor(age);
  if (!prog) { el.innerHTML = ""; return; }
  const young = age < 13 && state.user?.role === "athlete";
  el.innerHTML = `<div class="progcard">
    <div class="eyebrow">${esc(prog.name)} program · ages ${esc(prog.ages)}</div>
    <div class="rowsub">${esc(prog.tagline)}</div>
    ${young ? `<div class="msg err" style="margin-top:10px">Players under 13 need a parent account. Ask a parent to sign up as a parent and add you.</div>` : ""}
  </div>`;
}

function renderReview() {
  const el = $("#reviewBox");
  if (!el) return;
  const keys = allergyKeys();
  const rows = [];
  if (fs.answer === "no" && !keys.length) rows.push(["Allergies", "None"]);
  for (const k of keys) {
    const d = detailFor(k);
    const name = k.startsWith("other:") ? k.slice(6) : LABEL[k] || k;
    const bits = [d.severity];
    if (d.anaphylaxis) bits.push("anaphylaxis history");
    if (d.epinephrine) bits.push("carries EpiPen");
    if (d.cross || d.severity === "severe") bits.push("avoid may-contain");
    rows.push(["Allergy", `${name} (${bits.join(", ")})`]);
  }
  const med = checked("medical").map((k) => LABEL[k]);
  const diets = checked("diets").map((k) => LABEL[k]);
  const intol = checked("intol").map((k) => LABEL["i:" + k]);
  const dis = val("dislikes");
  if (med.length) rows.push(["Medical diet", med.join(", ")]);
  if (diets.length) rows.push(["Diet", diets.join(", ")]);
  if (intol.length) rows.push(["Intolerances", intol.join(", ")]);
  if (dis) rows.push(["Won't eat", dis]);
  if (!rows.length) rows.push(["Food safety", "No restrictions"]);
  const epi = keys.some((k) => detailFor(k).epinephrine || detailFor(k).anaphylaxis);
  const t1d = checked("medical").includes("type1_diabetes");
  const age = ageFromDob(val("dob"));
  const prog = programFor(age);
  el.innerHTML = `
    <div class="card tight" style="background:var(--bg2)">
      <h3>Food safety</h3>
      <ul class="list">${rows.map(([a, b]) => `<li><div style="flex:1"><div class="rowsub">${esc(a)}</div><div class="rowtitle">${esc(b)}</div></div></li>`).join("")}</ul>
      ${epi ? `<div class="warnbox" style="margin-top:10px">We'll remind ${who()} to pack the EpiPen for every game, and flag it for the coach.</div>` : ""}
      ${t1d ? `<div class="warnbox">Type 1 diabetes: our carb timing is general guidance. Build the game-day plan with ${isParent() ? "your athlete's" : "your"} diabetes care team.</div>` : ""}
      <p class="hint">Every plan, reminder and grocery list is filtered against this list. Packaged foods can change, so always read labels.</p>
    </div>
    ${prog ? `<div class="card tight" style="background:var(--bg2)"><h3>Program</h3><div class="rowtitle">${esc(prog.name)} · ages ${esc(prog.ages)}</div><div class="rowsub">${esc(prog.tagline)}</div></div>` : ""}`;
}

function fillPositions(selected) {
  const cfg = SPORTS[$("#sport").value] || SPORTS.other;
  $("#position").innerHTML = cfg.positions.map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("");
}

function showStep(n) {
  step = n;
  $$("section[data-step]").forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
  $$(".steps i").forEach((b, i) => b.classList.toggle("on", i < n));
  $("#stepTitle").textContent = STEP_TITLES[n];
  $("#stepNum").textContent = n;
  $("#prevBtn").hidden = n === 1;
  $("#nextBtn").textContent = n === STEPS ? "Save and finish" : "Next";
  if ($("#stepSub")) $("#stepSub").hidden = n !== 1;
  if (n === 4) renderReview();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
export async function render(el, ctx) {
  isNew = ctx.sub === "new" || !ctx.profile;
  const p = isNew ? null : ctx.profile;
  pendingAvatar = null;
  fs = { answer: null, detail: {} };
  if (p) {
    const al = p.nutrition?.allergies || [];
    fs.answer = al.length ? "yes" : p.nutrition?.safetyConfirmedAt ? "no" : null;
    for (const a of al) {
      const k = a.allergen === "other" ? "other:" + String(a.note || "").toLowerCase() : a.allergen;
      fs.detail[k] = { severity: a.severity || "moderate", anaphylaxis: !!a.anaphylaxis, epinephrine: !!a.epinephrine, cross: !!a.avoidCrossContact };
    }
  }

  if (isNew) {
    const first = !state.profiles.length;
    el.innerHTML = `
      <div class="steps" aria-hidden="true">${"<i></i>".repeat(STEPS)}</div>
      <form class="card" data-submit="saveProfile" novalidate>
        <div class="eyebrow">Step <span id="stepNum">1</span> of ${STEPS}</div>
        <h2 id="stepTitle">Food safety</h2>
        <p class="sub" id="stepSub">${first ? (isParent() ? "We start with food safety, so nothing we suggest can cause a problem." : "We start with food safety, so nothing we suggest can cause a problem for you.") : "Add another athlete. Food safety first."}</p>
        ${foodSection(p)}${aboutSection(p)}${bodySection(p)}${reviewSection(p)}
        <div class="actions">
          <button type="button" class="btn ghost" id="prevBtn" data-act="profilePrev">Back</button>
          <button type="button" class="btn primary" id="nextBtn" data-act="profileNext">Next</button>
        </div>
        <div id="out"></div>
      </form>`;
    fillPositions();
    showStep(1);
  } else {
    const unconfirmed = !p.nutrition?.safetyConfirmedAt;
    el.innerHTML = `
      ${unconfirmed ? `<div class="warnbox">Please review the food-safety questions below and confirm them at the bottom.</div>` : ""}
      <form class="card" data-submit="saveProfile" novalidate>
        <h2>${esc(p.identity.fullName)}</h2>
        <p class="sub">Player ID ${esc(p.identity.playerCode || "")}</p>
        <h3>Food safety</h3>${foodSection(p)}
        <h3 style="margin-top:22px">About</h3>${aboutSection(p)}
        <h3 style="margin-top:22px">Body and routine</h3>${bodySection(p)}
        <h3 style="margin-top:22px">Review</h3>${reviewSection(p)}
        <div class="actions"><button class="btn primary block" type="submit">Save changes</button></div>
        <div id="out"></div>
      </form>
      <div class="card">
        <h3>Remove this athlete</h3>
        <p class="sub">Deletes this profile, its schedule and every check-in. This can't be undone.</p>
        <button class="btn danger block" data-act="deleteProfile">Delete ${esc(p.identity.fullName.split(" ")[0])}'s profile</button>
      </div>`;
    fillPositions(p.sport.positions?.[0]);
    renderReview();
    if (location.hash.includes("food")) setTimeout(() => $("#food")?.scrollIntoView({ block: "start" }), 50);
  }
  renderAllergyDetails();
  renderProgramPreview();
  $("#sport").addEventListener("change", () => fillPositions());
  $("#photoInput").addEventListener("change", onPhoto);
  $("#dob").addEventListener("input", () => {
    renderProgramPreview();
    // New profiles: default the bedtime to the age's sleep need, unless it was changed by hand.
    const bed = $("#bed");
    if (isNew && bed && !bed.dataset.touched) {
      const age = ageFromDob(val("dob"));
      if (age !== undefined) bed.value = age <= 9 ? "20:00" : age <= 12 ? "20:30" : age <= 18 ? "22:00" : "22:30";
    }
  });
  $("#bed").addEventListener("input", (e) => (e.target.dataset.touched = "1"));
  $("#homeZip").addEventListener("input", (e) => lookupZip(e.target.value, "#zipPlace"));
  if (val("homeZip")) lookupZip(val("homeZip"), "#zipPlace");
  $("#otherAllergy").addEventListener("input", () => { renderAllergyDetails(); if (!isNew) renderReview(); });
  el.addEventListener("change", () => { if (!isNew || step === 4) renderReview(); });
}

/** Shows "Roseland, NJ · 72°F now" under a ZIP field. */
export async function lookupZip(zip, target) {
  const el = $(target);
  if (!el) return;
  zip = String(zip || "").trim();
  if (!/^\d{5}$/.test(zip)) { el.textContent = zip ? "Keep typing: 5 digits." : "We check the forecast so plans adjust for heat and cold."; return; }
  el.textContent = "Checking…";
  const r = await api(`/api/weather/${zip}`);
  if (!r.ok) { el.textContent = r.data?.message || "We couldn't find that ZIP code."; return; }
  const now = r.data.next12?.[0];
  el.textContent = `${r.data.place || "ZIP found"}${now?.tempF != null ? ` · ${now.tempF}°F now` : ""}`;
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
    if (!fs.answer) return `Please answer: ${isParent() ? "does your athlete" : "do you"} have any food allergies?`;
    if (fs.answer === "yes" && !allergyKeys().length) return "Pick the allergy, or type it under \"Anything else?\".";
  }
  if (n === 2) {
    if (!val("fullName")) return "Enter the athlete's name.";
    const age = ageFromDob(val("dob"));
    if (age === undefined) return "Enter a date of birth. It sets the age program.";
    if (age < 6) return "The app is built for athletes 6 and older.";
    if (age < 13 && state.user?.role === "athlete") return "Players under 13 need a parent account. Ask a parent to sign up as a parent and add you.";
  }
  if (n === 3) {
    if (val("homeZip") && !/^\d{5}$/.test(val("homeZip"))) return "Enter a 5-digit ZIP code, or leave it blank.";
    const lb = Number(val("weight"));
    if (!lb || lb < 40 || lb > 350) return "Enter weight in pounds (40-350).";
    const ft = Number(val("heightFt")), inch = Number(val("heightIn"));
    if (!(ft >= 3 && ft <= 7) || !(inch >= 0 && inch <= 11)) return "Enter height as feet (3-7) and inches (0-11).";
  }
  if (n === 4 && !$("#confirmSafety").checked) return "Please confirm the food-safety information is complete and correct.";
  return null;
}

function payload(existing) {
  const sport = val("sport");
  const allergies = allergyKeys().map((k) => {
    const d = detailFor(k);
    const base = k.startsWith("other:") ? { allergen: "other", note: k.slice(6) } : { allergen: k };
    return { ...base, severity: d.severity, anaphylaxis: d.anaphylaxis || undefined, epinephrine: d.epinephrine || undefined, avoidCrossContact: d.cross || d.severity === "severe" || undefined };
  });
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
    routine: { wakeTime: val("wake") || "07:00", bedTime: val("bed") || "22:00", usualPracticeTime: val("practice") || "17:00", homeZip: val("homeZip") || undefined },
    contact,
    nutrition: {
      ...(base.nutrition || {}),
      allergies,
      medicalDiets: checked("medical"),
      dietaryRestrictions: checked("diets"),
      intolerances: checked("intol"),
      dislikes: val("dislikes").split(",").map((s) => s.trim()).filter(Boolean),
      safetyConfirmedAt: new Date().toISOString(),
    },
    schedule: base.schedule || { events: [] },
  };
}

const out = (kind, text) => { $("#out").innerHTML = msg(kind, text); $("#out").scrollIntoView({ block: "nearest" }); };

export const actions = {
  pickPhoto: () => $("#photoInput").click(),
  allergyAnswer(btn) {
    fs.answer = btn.dataset.v;
    btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
    $("#allergyBox").hidden = fs.answer !== "yes";
    if (fs.answer === "no") { $$("#allergies input").forEach((c) => (c.checked = false)); $("#otherAllergy").value = ""; }
    renderAllergyDetails();
  },
  allergyPick() { setTimeout(renderAllergyDetails); },
  allergySev(btn) {
    const d = detailFor(btn.dataset.key);
    d.severity = btn.dataset.v;
    if (d.severity === "severe") d.cross = true;
    renderAllergyDetails();
    if (!isNew) renderReview();
  },
  allergyFlag(input) {
    setTimeout(() => {
      const d = detailFor(input.dataset.key);
      d[input.dataset.f] = input.checked;
      if (input.dataset.f === "anaphylaxis" && input.checked) { d.severity = "severe"; d.cross = true; renderAllergyDetails(); }
      if (!isNew) renderReview();
    });
  },
  profilePrev: () => showStep(Math.max(1, step - 1)),
  async profileNext(el) {
    const err = stepErrors(step);
    if (err) return out("err", err);
    $("#out").innerHTML = "";
    if (step < STEPS) { showStep(step + 1); return; }
    await actions.saveProfile(el.closest("form"));
  },

  async saveProfile(form) {
    if (isNew && step < STEPS) return actions.profileNext(form.querySelector("#nextBtn"));
    for (const n of [1, 2, 3, 4]) { const e = stepErrors(n); if (e) return out("err", e); }
    const editing = !isNew && active();
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
    go(editing ? "#/more" : "#/program?welcome=1");
  },

  async deleteProfile() {
    const p = active();
    if (!p || !window.confirm(`Delete ${p.identity.fullName}'s profile and all of their data? This can't be undone.`)) return;
    const r = await api(`/api/profiles/${p.id}`, { method: "DELETE" });
    if (!r.ok) return toast(errText(r));
    await loadProfiles();
    toast("Profile deleted");
    go("#/today");
    rerender();
  },
};
