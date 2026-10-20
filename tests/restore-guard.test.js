import test from "node:test";
import assert from "node:assert/strict";
import { RestoreGuard, singleFlight, isKnownMessage, MassCloseDetector } from "../ext/lib/core.js";

test("RestoreGuard: active during restore, rejects re-entry, tail then expires", () => {
  let now = 1000; const g = new RestoreGuard(120000, () => now);
  assert.equal(g.active(), false);
  const tok = g.begin(); assert.ok(tok); assert.equal(g.active(), true);
  assert.equal(g.begin(), null, "second concurrent restore rejected");
  now += 5000; g.end(tok, 3000); assert.equal(g.active(), true);
  now += 3001; assert.equal(g.active(), false);
  assert.ok(g.begin(), "can restore again afterwards");
});
test("RestoreGuard: auto-expires if end never called", () => {
  let now = 0; const g = new RestoreGuard(1000, () => now); g.begin();
  now = 1001; assert.equal(g.active(), false);
});
test("RestoreGuard: stale end token does not shorten a newer restore", () => {
  let now = 0; const g = new RestoreGuard(1000, () => now); const a = g.begin();
  now = 1001; const b = g.begin(); g.end(a, 0); assert.equal(g.active(), true); g.end(b, 0); assert.equal(g.active(), false);
});
test("restore placeholder closes are not a mass close when guarded", () => {
  // Without guard, closing 5 placeholder tabs in 3s would fire mass_close -> forced export.
  const d = new MassCloseDetector(5, 3000); let fired = false;
  for (let i = 0; i < 5; i++) fired = d.record(i * 100) || fired; assert.equal(fired, true);
  let now = 0; const g = new RestoreGuard(1000, () => now); g.begin(); const d2 = new MassCloseDetector(5, 3000); fired = false;
  for (let i = 0; i < 5; i++) { now = i * 100; if (!g.active()) fired = d2.record(now) || fired; } assert.equal(fired, false);
});
test("singleFlight shares in-flight call and allows next after settle", async () => {
  let n = 0; let rel; const f = singleFlight(() => { n++; return new Promise(r => { rel = r; }); });
  const p1 = f(), p2 = f(); assert.equal(p1, p2); await Promise.resolve(); rel(7); assert.equal(await p1, 7); assert.equal(n, 1);
  const p3 = f(); await Promise.resolve(); rel(8); assert.equal(await p3, 8); assert.equal(n, 2);
});
test("singleFlight releases after rejection", async () => {
  let n = 0; const f = singleFlight(async () => { n++; throw new Error("x"); });
  await assert.rejects(f()); await assert.rejects(f()); assert.equal(n, 2);
});
test("isKnownMessage", () => {
  assert.equal(isKnownMessage({ type: "status" }), true);
  assert.equal(isKnownMessage({ type: "bogus" }), false);
  assert.equal(isKnownMessage(null), false); assert.equal(isKnownMessage("status"), false);
});
