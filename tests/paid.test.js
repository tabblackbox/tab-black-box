import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPaidService, paidStatus, nextPaidCache } from "../ext/lib/paid.js";
import { prune, visibleSnapshots, KNOWN_MESSAGES } from "../ext/lib/core.js";
const DAY = 864e5;
const mem = () => { const d = {}; return { d, get: async (k) => (k in d ? { [k]: d[k] } : {}), set: async (o) => Object.assign(d, o) }; };
const mockExtpay = (user) => { const calls = []; return { calls, user, getUser: async function () { calls.push("getUser"); if (this.user instanceof Error) throw this.user; return this.user; },
  openPaymentPage: async (p) => calls.push("pay:" + (p ?? "")), openLoginPage: async () => calls.push("login") }; };

test("paid = user.paid from getUser, cached in storage", async () => {
  const st = mem(); let now = 10 * DAY; const ex = mockExtpay({ paid: true, paidAt: new Date() });
  const svc = createPaidService({ extpay: ex, storage: st, clock: () => now });
  assert.equal((await svc.status()).paid, false, "unknown before first check");
  await svc.refresh(); assert.equal((await svc.status()).paid, true); assert.equal(st.d.paidCache.everPaid, true);
  ex.user = { paid: false }; await svc.refresh(); const s = await svc.status();
  assert.equal(s.paid, false); assert.equal(s.reason, "not_paid_anymore");
});
test("offline getUser failure keeps last known paid status for 30 days only", async () => {
  const st = mem(); let now = 0; const ex = mockExtpay({ paid: true });
  const svc = createPaidService({ extpay: ex, storage: st, clock: () => now });
  await svc.refresh(); ex.user = new Error("offline");
  now = 29 * DAY; await svc.refresh(); assert.deepEqual(await svc.status(), { paid: true, reason: "offline_grace" });
  now = 31 * DAY; await svc.refresh(); assert.equal((await svc.status()).reason, "grace_expired");
  ex.user = { paid: true }; await svc.refresh(); assert.equal((await svc.status()).paid, true, "recovers once reachable");
});
test("failure before any success is free; getUser hang times out", async () => {
  const st = mem(); const ex = { getUser: () => new Promise(() => {}) };
  const svc = createPaidService({ extpay: ex, storage: st, timeoutMs: 20 });
  const c = await svc.refresh(); assert.match(c.lastError, /timeout/); assert.equal((await svc.status()).paid, false);
});
test("concurrent refreshes share one getUser call", async () => {
  const st = mem(); const ex = mockExtpay({ paid: false }); const svc = createPaidService({ extpay: ex, storage: st });
  await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]); assert.equal(ex.calls.length, 1);
});
test("upgrade opens 'yearly' plan, manage opens payment page, login opens login page", async () => {
  const ex = mockExtpay({}); const svc = createPaidService({ extpay: ex, storage: mem() });
  await svc.upgrade(); await svc.manage(); await svc.login();
  assert.deepEqual(ex.calls, ["pay:yearly", "pay:", "login"]);
  for (const t of ["upgrade", "manageSubscription", "login", "refreshPaid"]) assert.ok(KNOWN_MESSAGES.includes(t));
  assert.ok(!KNOWN_MESSAGES.includes("setLicense"));
});
test("pure helpers", () => {
  assert.equal(paidStatus(null, 0).paid, false);
  assert.equal(nextPaidCache(null, { ok: false, error: "x" }, 5).paid, false);
});
test("30-day pruning for unpaid, unlimited for paid", () => {
  const now = 100 * DAY; const snaps = [{ ts: now - 40 * DAY }, { ts: now - 1 * DAY }];
  assert.equal(prune(snaps, now, { paid: false }).length, 1);
  assert.equal(prune(snaps, now, { paid: true }).length, 2);
  assert.equal(visibleSnapshots(snaps, now, false).length, 1);
});
test("manifest: only ExtPay additions, no license endpoint left", () => {
  const m = JSON.parse(fs.readFileSync(new URL("../ext/manifest.json", import.meta.url)));
  assert.deepEqual(m.permissions, ["tabs", "tabGroups", "storage", "unlimitedStorage", "alarms", "downloads"]);
  assert.equal(m.host_permissions, undefined);
  assert.deepEqual(m.content_scripts, [{ matches: ["https://extensionpay.com/*"], js: ["lib/ExtPay.js"], run_at: "document_start" }]);
  const cfg = fs.readFileSync(new URL("../ext/lib/config.js", import.meta.url), "utf8");
  assert.doesNotMatch(cfg, /LICENSE_ENDPOINT|PAYMENT_LINK/); assert.match(cfg, /EXTPAY_ID = "tab-black-box"/);
  const bg = fs.readFileSync(new URL("../ext/background.js", import.meta.url), "utf8");
  assert.match(bg, /ExtPay\(EXTPAY_ID\)/); assert.match(bg, /startBackground\(\)/); assert.match(bg, /onPaid\.addListener/);
});
test("vendored ExtPay.js is the pinned upstream 3.1.2 build", async () => {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256").update(fs.readFileSync(new URL("../ext/lib/ExtPay.js", import.meta.url))).digest("hex");
  assert.equal(h, "ec38f20eeea04502e68e99b939fe0e188045bf68cabe605080cdad79c7fae15a");
});
