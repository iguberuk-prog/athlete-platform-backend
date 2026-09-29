// Sign up, log in, forgot password, set new password.

import { $, msg } from "../ui.js";
import { signIn, signUp, sendReset, updatePassword } from "../api.js";
import { afterSignIn } from "../app.js";

const brand = `
  <div class="brandbig"><div class="mark">A</div><div><b>Athlete Performance</b><div class="muted small">Game-day fuel and recovery</div></div></div>`;

function login() {
  return `
  <div class="auth">
    ${brand}
    <h1>Fuel your <span class="hl">game day.</span></h1>
    <p class="muted">What to eat, when to eat it, and how to recover. Built around your body and your schedule.</p>
    <form class="card" data-submit="login" novalidate>
      <h2>Log in</h2>
      <label class="f" for="email">Email</label>
      <input class="input" id="email" type="email" autocomplete="email" inputmode="email" required />
      <label class="f" for="pass">Password</label>
      <input class="input" id="pass" type="password" autocomplete="current-password" required />
      <div class="actions"><button class="btn primary block" type="submit">Log in</button></div>
      <button class="btn link" type="button" data-act="nav" data-to="#/forgot">Forgot password?</button>
      <div id="out"></div>
    </form>
    <button class="btn ghost block" data-act="nav" data-to="#/signup">New here? Create an account</button>
    <p class="disc">By using the app you agree to the <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.</p>
  </div>`;
}

function signup() {
  return `
  <div class="auth">
    ${brand}
    <h1>Create your account</h1>
    <form class="card" data-submit="signup" novalidate>
      <h3>Who is signing up?</h3>
      <div class="roles">
        <label class="role"><input type="radio" name="role" value="athlete" checked><div><b>I'm an athlete</b><span>13 or older, setting up my own plan</span></div></label>
        <label class="role"><input type="radio" name="role" value="parent"><div><b>I'm a parent or guardian</b><span>Manage plans for one or more kids</span></div></label>
        <label class="role"><input type="radio" name="role" value="coach"><div><b>I'm a coach</b><span>See my team's readiness and food needs</span></div></label>
      </div>
      <label class="f" for="email">Email</label>
      <input class="input" id="email" type="email" autocomplete="email" inputmode="email" required />
      <label class="f" for="pass">Password</label>
      <input class="input" id="pass" type="password" autocomplete="new-password" minlength="8" required />
      <div class="hint">At least 8 characters.</div>
      <label class="check"><input type="checkbox" id="age"><span id="ageText">I am 13 or older. If I am under 18, a parent or guardian knows I am using this app.</span></label>
      <label class="check"><input type="checkbox" id="terms"><span>I agree to the <a href="/terms.html" target="_blank">Terms</a> and <a href="/privacy.html" target="_blank">Privacy Policy</a>.</span></label>
      <div class="actions"><button class="btn primary block" type="submit">Create account</button></div>
      <div id="out"></div>
    </form>
    <button class="btn ghost block" data-act="nav" data-to="#/login">Already have an account? Log in</button>
  </div>`;
}

function forgot() {
  return `
  <div class="auth">
    ${brand}
    <h1>Reset your password</h1>
    <form class="card" data-submit="forgot" novalidate>
      <p class="sub">Enter your account email. We will send you a link to set a new password.</p>
      <label class="f" for="email">Email</label>
      <input class="input" id="email" type="email" autocomplete="email" inputmode="email" required />
      <div class="actions"><button class="btn primary block" type="submit">Send reset link</button></div>
      <div id="out"></div>
    </form>
    <button class="btn ghost block" data-act="nav" data-to="#/login">Back to log in</button>
  </div>`;
}

function reset() {
  return `
  <div class="auth">
    ${brand}
    <h1>Set a new password</h1>
    <form class="card" data-submit="reset" novalidate>
      <label class="f" for="pass">New password</label>
      <input class="input" id="pass" type="password" autocomplete="new-password" minlength="8" required />
      <label class="f" for="pass2">Confirm new password</label>
      <input class="input" id="pass2" type="password" autocomplete="new-password" minlength="8" required />
      <div class="actions"><button class="btn primary block" type="submit">Save password</button></div>
      <div id="out"></div>
    </form>
  </div>`;
}

export async function render(el, route) {
  const screens = { signup, forgot, reset };
  el.innerHTML = (screens[route.name] || login)();
  const roleInputs = el.querySelectorAll('input[name="role"]');
  roleInputs.forEach((r) => r.addEventListener("change", () => {
    const t = $("#ageText");
    if (!t) return;
    const role = el.querySelector('input[name="role"]:checked').value;
    t.textContent = role === "athlete"
      ? "I am 13 or older. If I am under 18, a parent or guardian knows I am using this app."
      : "I am 18 or older.";
  }));
}

const out = (kind, text) => { const o = $("#out"); if (o) o.innerHTML = msg(kind, text); };
const busy = (form, on) => { const b = form.querySelector('button[type="submit"]'); if (b) b.disabled = on; };

export const actions = {
  async login(form) {
    const email = $("#email").value.trim(), pass = $("#pass").value;
    if (!email || !pass) return out("err", "Enter your email and password.");
    busy(form, true);
    const r = await signIn(email, pass);
    busy(form, false);
    if (!r.ok) return out("err", r.error === "Invalid login credentials" ? "That email and password don't match." : r.error);
    await afterSignIn();
  },

  async signup(form) {
    const email = $("#email").value.trim(), pass = $("#pass").value;
    const role = form.querySelector('input[name="role"]:checked').value;
    if (!email || !pass) return out("err", "Enter your email and a password.");
    if (pass.length < 8) return out("err", "Use at least 8 characters for your password.");
    if (!$("#age").checked) {
      return out("err", role === "athlete"
        ? "You need to be 13 or older to have your own account. Ask a parent to create a parent account for you."
        : "Parent and coach accounts are for adults 18 or older.");
    }
    if (!$("#terms").checked) return out("err", "Please agree to the Terms and Privacy Policy.");
    busy(form, true);
    const r = await signUp(email, pass, role);
    busy(form, false);
    if (!r.ok) return out("err", r.error);
    if (!r.session) return out("ok", "Check your email to confirm your account, then log in.");
    await afterSignIn();
  },

  async forgot(form) {
    const email = $("#email").value.trim();
    if (!email) return out("err", "Enter your email.");
    busy(form, true);
    const r = await sendReset(email);
    busy(form, false);
    out(r.ok ? "ok" : "err", r.ok ? `If ${email} has an account, a reset link is on its way. Check your inbox and spam folder.` : r.error);
  },

  async reset(form) {
    const a = $("#pass").value, b = $("#pass2").value;
    if (a.length < 8) return out("err", "Use at least 8 characters.");
    if (a !== b) return out("err", "The two passwords don't match.");
    busy(form, true);
    const r = await updatePassword(a);
    busy(form, false);
    if (!r.ok) return out("err", r.error);
    out("ok", "Password saved. Signing you in…");
    setTimeout(() => { history.replaceState(null, "", "/#/today"); afterSignIn(); }, 800);
  },
};

