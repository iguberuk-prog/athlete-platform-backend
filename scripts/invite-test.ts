/** Tests: invite codes, links, email sending and limits, redeem.  Run: npx tsx scripts/invite-test.ts */

process.env.APP_URL = "https://app.test";
import { openDatabase } from "../src/data/db.js";
import { SqliteRecordRepository } from "../src/data/sqliteRepository.js";
import { InviteService, inviteLink, inviteText } from "../src/services/inviteService.js";
import { MemoryMailer } from "../src/services/notifier.js";

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => { if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); } };

(async () => {
  const records = new SqliteRecordRepository(openDatabase(":memory:"));
  const mailer = new MemoryMailer();
  const svc = new InviteService(records, mailer);

  const a = await svc.mine("u1", "Igor Guberuk");
  check("code: 6 letters, no look-alikes", /^[A-HJ-NP-Z2-9]{6}$/.test(a.code), a.code);
  check("same code every time", (await svc.mine("u1")).code === a.code);
  check("different users get different codes", (await svc.mine("u2")).code !== a.code);
  check("link opens the invite page with first name only", a.link === `https://app.test/#/invite?code=${a.code}&from=Igor`, a.link);
  check("message names the sender and has the link", a.text.startsWith("Igor Guberuk invited you") && a.text.includes(a.link));
  check("name can't inject markup", !inviteLink("X", "<script>").includes("<") && !inviteText("<b>x</b>", "l").includes("<"));
  check("joined starts at 0", a.joined === 0);

  // Email without keys
  const nc = await svc.email("u1", "igor@x.com", { to: "friend@x.com", from: "Igor" }, "2026-09-30");
  check("email without Resend: tells the app to use Share", !nc.ok && nc.code === "not_configured");

  process.env.RESEND_API_KEY = "k"; process.env.EMAIL_FROM = "App <a@b.com>";
  check("bad address caught", !(await svc.email("u1", "igor@x.com", { to: "friend@", from: "Igor" }, "2026-09-30")).ok);
  check("more than 10 refused", !(await svc.email("u1", "igor@x.com", { to: Array.from({ length: 11 }, (_, i) => `f${i}@x.com`) }, "2026-09-30")).ok);
  check("empty refused", !(await svc.email("u1", "igor@x.com", { to: "" }, "2026-09-30")).ok);
  const ok = await svc.email("u1", "igor@x.com", { to: "Friend@X.com, friend@x.com; mom@y.org igor@x.com", from: "Igor", note: "Try this <b>now</b>" }, "2026-09-30");
  check("sends to unique addresses, skips your own", ok.ok && ok.value.sent === 2 && ok.value.skipped[0] === "igor@x.com", JSON.stringify(ok));
  const mail = mailer.sent.at(-1)!;
  check("email: subject, button link, code", mail.subject === "Igor invited you to Athlete Performance" && mail.html.includes(`#/invite?code=${a.code}`) && mail.html.includes(a.code));
  check("email: note escaped, no raw tags", !mail.html.includes("<b>now") && mail.html.includes("Try this"));
  for (let i = 0; i < 9; i++) await svc.email("u1", "igor@x.com", { to: `x${i}@x.com, y${i}@x.com`, from: "Igor" }, "2026-09-30");
  const lim = await svc.email("u1", "igor@x.com", { to: "late@x.com", from: "Igor" }, "2026-09-30");
  check("20 emails a day limit", !lim.ok && lim.code === "limit", JSON.stringify(lim));
  check("limit resets the next day", (await svc.email("u1", "igor@x.com", { to: "late@x.com", from: "Igor" }, "2026-10-01")).ok);

  // Redeem
  check("unknown code", !(await svc.redeem("new1", "ZZZZZZ")).ok);
  const r1 = await svc.redeem("new1", a.code.toLowerCase());
  check("friend joins: counted", r1.ok && r1.value.counted);
  check("same friend again: not counted twice", (await svc.redeem("new1", a.code)).ok && !((await svc.redeem("new1", a.code)) as any).value.counted);
  check("your own code: not counted", !((await svc.redeem("u1", a.code)) as any).value.counted);
  await svc.redeem("new2", a.code);
  check("joined count shows 2", (await svc.mine("u1")).joined === 2);
  const lk = await svc.lookup(a.code);
  check("public lookup: valid, no personal data", lk.valid === true && !JSON.stringify(lk).includes("u1"));
  process.env.APP_STORE_URL = "https://apps.apple.com/app/id123";
  check("store link shows once listed", (await svc.lookup(a.code)).stores.ios === "https://apps.apple.com/app/id123");

  console.log(`\nInvite tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
